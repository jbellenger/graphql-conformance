'use strict';

// End-to-end check that Hot Chocolate's driver emits a GraphQL
// incremental-delivery `multipart/mixed` response for @defer/@stream queries
// (not a collapsed single-part JSON body) and that applyIncrementalMerge
// reassembles it into the wiring-spec shape. Skips if Docker is unreachable.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const { DockerDriver, readManifest } = require('./driver');
const { parseMultipartMixed, parseContentType, applyIncrementalMerge } = require('./execute');

const SCHEMA = `
schema { query: Query }
type Query { hero: Hero!, friends: [Friend!]! }
type Hero { name: String!, friend: Friend! }
type Friend { name: String!, value: Int! }
directive @defer(if: Boolean = true, label: String) on FRAGMENT_SPREAD | INLINE_FRAGMENT
directive @stream(if: Boolean = true, label: String, initialCount: Int = 0) on FIELD
`;

const QUERY = `
query DeferStream {
  hero {
    name
    ... @defer { friend { name } }
  }
  friends @stream(initialCount: 1) { name }
}
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
        Accept: 'application/json, multipart/mixed',
      },
      timeout: 30_000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('hot-chocolate driver: @defer/@stream multipart emission', () => {
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

    const implDir = path.resolve(__dirname, '..', '..', 'impls', 'hot-chocolate');
    const manifest = readManifest(implDir);
    driver = new DockerDriver({
      name: 'hot-chocolate',
      implDir,
      manifest,
      runId: 'hc-driver-test',
    });
    await driver.ensureImage({ onProgress: () => {} });
    await driver.start();
  }, { timeout: 180_000 });

  after(async () => {
    if (driver) await driver.stop();
  });

  it('returns multipart/mixed whose parts collapse to wiring-spec data', async (t) => {
    if (skipReason) { t.skip(skipReason); return; }

    const response = await postJson({
      host: driver.host,
      port: driver.hostPort,
      execPath: driver.manifest.runtime.executePath,
      body: { schema: SCHEMA, query: QUERY },
    });

    assert.equal(response.status, 200, `unexpected status ${response.status}: ${response.body.toString('utf8')}`);
    const ct = parseContentType(response.headers['content-type']);
    assert.equal(ct.type, 'multipart/mixed',
      `expected multipart/mixed, got ${response.headers['content-type']}`);
    assert.ok(ct.params.boundary, 'boundary param present');

    const parts = parseMultipartMixed(response.body, ct.params.boundary);
    assert.ok(parts.length >= 2,
      `expected 2+ multipart parts (initial + at least one incremental), got ${parts.length}`);

    const merged = applyIncrementalMerge(parts[0].body, parts.slice(1));

    assert.deepEqual(merged.data, {
      hero: { name: 'str', friend: { name: 'str' } },
      friends: [{ name: 'str' }, { name: 'str' }],
    });
    assert.ok(!('errors' in merged), `unexpected errors: ${JSON.stringify(merged.errors)}`);
  });
});
