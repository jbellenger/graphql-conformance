'use strict';

// Verifies that drivers which natively validate (graphql-js-16, graphql-js-17,
// grafast) surface schema-level and document-level validation errors as
// {errors: [...]} GraphQL responses rather than executing invalid input.
// Skips when Docker is unreachable.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const { DockerDriver, readManifest } = require('./driver');

const DRIVERS = ['graphql-js-16', 'graphql-js-17', 'grafast'];

const VALID_SCHEMA = `type Query { hello: String }`;
const VALID_QUERY = `{ hello }`;

// Unknown field `nope` — rejected by graphql-js `validate()`, not by `parse()`.
const QUERY_UNKNOWN_FIELD = `{ hello nope }`;

// `User implements Node` without `id: ID!` — accepted by `buildSchema()`,
// rejected by `validateSchema()`.
const INVALID_SCHEMA = `
  interface Node { id: ID! }
  type User implements Node { name: String! }
  type Query { user: User }
`;

function postJson({ host, port, execPath, body }) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  return new Promise((resolve, reject) => {
    const req = http.request({
      host,
      port,
      path: execPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
        Accept: 'application/json',
      },
      timeout: 30_000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

for (const name of DRIVERS) {
  describe(`${name} driver: validation`, () => {
    let driver = null;
    let skipReason = null;

    before(async () => {
      try {
        const Docker = require('dockerode');
        await new Docker().ping();
      } catch (e) {
        skipReason = `docker not reachable: ${e.message}`;
        return;
      }

      const implDir = path.resolve(__dirname, '..', '..', 'impls', name);
      const manifest = readManifest(implDir);
      driver = new DockerDriver({
        name,
        implDir,
        manifest,
        runId: `${name}-validation-test`,
      });
      await driver.ensureImage({ onProgress: () => {} });
      await driver.start();
    }, { timeout: 180_000 });

    after(async () => {
      if (driver) await driver.stop();
    });

    async function post(body) {
      return postJson({
        host: driver.host,
        port: driver.hostPort,
        execPath: driver.manifest.runtime.executePath,
        body,
      });
    }

    it('returns data for a valid schema and query', async (t) => {
      if (skipReason) { t.skip(skipReason); return; }
      const response = await post({ schema: VALID_SCHEMA, query: VALID_QUERY });
      assert.equal(response.status, 200, `body: ${response.body}`);
      const parsed = JSON.parse(response.body);
      assert.equal(parsed.data && parsed.data.hello, 'str');
      assert.ok(!parsed.errors, `unexpected errors: ${JSON.stringify(parsed.errors)}`);
    });

    it('returns errors for an invalid document (unknown field)', async (t) => {
      if (skipReason) { t.skip(skipReason); return; }
      const response = await post({ schema: VALID_SCHEMA, query: QUERY_UNKNOWN_FIELD });
      assert.equal(response.status, 200, `body: ${response.body}`);
      const parsed = JSON.parse(response.body);
      assert.ok(Array.isArray(parsed.errors) && parsed.errors.length > 0,
        `expected errors array, got ${response.body}`);
      assert.ok(parsed.errors.every((e) => typeof e.message === 'string' && e.message.length > 0),
        `every error should have a message: ${JSON.stringify(parsed.errors)}`);
      assert.ok(!parsed.data, `expected no data on validation failure, got ${JSON.stringify(parsed.data)}`);
    });

    it('returns errors for an invalid schema (interface field missing)', async (t) => {
      if (skipReason) { t.skip(skipReason); return; }
      const response = await post({ schema: INVALID_SCHEMA, query: `{ user { name } }` });
      assert.equal(response.status, 200, `body: ${response.body}`);
      const parsed = JSON.parse(response.body);
      assert.ok(Array.isArray(parsed.errors) && parsed.errors.length > 0,
        `expected errors array, got ${response.body}`);
      assert.ok(!parsed.data, `expected no data on validation failure, got ${JSON.stringify(parsed.data)}`);
    });
  });
}
