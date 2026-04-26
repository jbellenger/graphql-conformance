'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  buildImpl, buildResult, generateRunId, parseCliArgs, parseMaxImplFailures,
  readManifestFile, resultId,
} = require('./index');

describe('parseMaxImplFailures', () => {
  it('returns null for unset, empty, or non-numeric input', () => {
    assert.equal(parseMaxImplFailures(undefined), null);
    assert.equal(parseMaxImplFailures(null), null);
    assert.equal(parseMaxImplFailures(''), null);
    assert.equal(parseMaxImplFailures('not-a-number'), null);
  });

  it('returns null for zero and negative values (disabled)', () => {
    assert.equal(parseMaxImplFailures('0'), null);
    assert.equal(parseMaxImplFailures('-1'), null);
  });

  it('parses positive integers and truncates floats', () => {
    assert.equal(parseMaxImplFailures('10'), 10);
    assert.equal(parseMaxImplFailures('3.7'), 3);
  });
});

describe('parseCliArgs', () => {
  it('parses --max-impl-failures into maxImplFailures', () => {
    const cli = parseCliArgs(['--max-impl-failures', '12']);
    assert.equal(cli.maxImplFailures, 12);
  });

  it('absent flag yields null', () => {
    const cli = parseCliArgs([]);
    assert.equal(cli.maxImplFailures, null);
  });

  it('invalid flag value yields null (disabled)', () => {
    const cli = parseCliArgs(['--max-impl-failures', '0']);
    assert.equal(cli.maxImplFailures, null);
  });
});

describe('generateRunId', () => {
  it('returns a UUID-shaped opaque string', () => {
    const id = generateRunId();
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('returns a fresh id on every call', () => {
    assert.notEqual(generateRunId(), generateRunId());
  });
});

describe('resultId', () => {
  it('is deterministic for the same inputs', () => {
    const a = resultId('run-1', 'graphql-java', 'a/b');
    const b = resultId('run-1', 'graphql-java', 'a/b');
    assert.equal(a, b);
  });

  it('differs when any input changes', () => {
    const base = resultId('run-1', 'graphql-java', 'a/b');
    assert.notEqual(base, resultId('run-2', 'graphql-java', 'a/b'));
    assert.notEqual(base, resultId('run-1', 'graphql-go', 'a/b'));
    assert.notEqual(base, resultId('run-1', 'graphql-java', 'a/c'));
  });

  it('returns a UUID v4-shaped string', () => {
    const id = resultId('run-1', 'graphql-java', 'a/b');
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('buildResult', () => {
  const base = { runId: 'run-1', implId: 'conformant', testCaseId: 'a/b' };

  it('populates id/runId/implId/testCaseId/status', () => {
    const r = buildResult({ ...base, status: 'fail' });
    assert.equal(r.id, resultId('run-1', 'conformant', 'a/b'));
    assert.equal(r.runId, 'run-1');
    assert.equal(r.implId, 'conformant');
    assert.equal(r.testCaseId, 'a/b');
    assert.equal(r.status, 'fail');
  });

  it('omits undefined expected/actual/error/stderr', () => {
    const r = buildResult({ ...base, status: 'fail' });
    assert.ok(!('expected' in r));
    assert.ok(!('actual' in r));
    assert.ok(!('error' in r));
    assert.ok(!('stderr' in r));
  });

  it('fail: carries both expected and actual', () => {
    const r = buildResult({
      ...base, status: 'fail',
      expected: { data: { x: 1 } }, actual: { data: { x: 2 } },
    });
    assert.deepStrictEqual(r.expected, { data: { x: 1 } });
    assert.deepStrictEqual(r.actual, { data: { x: 2 } });
  });

  it('error: carries error + stderr', () => {
    const r = buildResult({
      ...base, status: 'error',
      error: 'timeout', stderr: 'no response',
    });
    assert.equal(r.error, 'timeout');
    assert.equal(r.stderr, 'no response');
  });

  it('excluded: carries actual (reference response) without error field', () => {
    const r = buildResult({
      ...base,
      implId: 'ref',
      status: 'excluded',
      actual: { errors: [{ message: 'bad input' }] },
    });
    assert.equal(r.status, 'excluded');
    assert.deepStrictEqual(r.actual, { errors: [{ message: 'bad input' }] });
    assert.ok(!('error' in r));
  });
});

describe('buildImpl', () => {
  const rootDir = '/tmp/repo-root';

  function driver(overrides = {}) {
    return {
      name: 'graphql-java',
      source: 'in-tree',
      implDir: '/tmp/repo-root/impls/graphql-java',
      manifestPath: '/tmp/repo-root/impls/graphql-java/manifest.json',
      ...overrides,
    };
  }

  it('happy path: in-tree driver with full manifest', () => {
    const impl = buildImpl({
      driver: driver(),
      manifest: {
        language: 'Java',
        homepage: 'https://github.com/graphql-java/graphql-java',
        versionUrlTemplate: 'https://github.com/graphql-java/graphql-java/releases/tag/v{version}',
      },
      version: '25.0',
      rootDir,
    });
    assert.equal(impl.id, 'graphql-java');
    assert.equal(impl.name, 'graphql-java');
    assert.equal(impl.language, 'Java');
    assert.equal(impl.repoUrl, 'https://github.com/graphql-java/graphql-java');
    assert.equal(impl.version, '25.0');
    assert.equal(impl.versionUrl, 'https://github.com/graphql-java/graphql-java/releases/tag/v25.0');
    assert.equal(
      impl.manifestUrl,
      'https://github.com/jbellenger/graphql-conformance/blob/master/impls/graphql-java/manifest.json',
    );
  });

  it('does not emit isReference (derived per-run)', () => {
    const impl = buildImpl({ driver: driver(), manifest: {}, version: null, rootDir });
    assert.ok(!('isReference' in impl));
  });

  it('language falls back to "unknown" when manifest omits it', () => {
    const impl = buildImpl({ driver: driver(), manifest: {}, version: null, rootDir });
    assert.equal(impl.language, 'unknown');
  });

  it('versionUrl is undefined when version is null', () => {
    const impl = buildImpl({
      driver: driver(),
      manifest: { versionUrlTemplate: 'https://x/{version}' },
      version: null,
      rootDir,
    });
    assert.equal(impl.versionUrl, undefined);
  });

  it('versionUrl is undefined when template is absent', () => {
    const impl = buildImpl({ driver: driver(), manifest: {}, version: '25.0', rootDir });
    assert.equal(impl.versionUrl, undefined);
  });

  it('URL-encodes the version in versionUrl', () => {
    const impl = buildImpl({
      driver: driver(),
      manifest: { versionUrlTemplate: 'https://x/{version}' },
      version: 'v1.2 beta',
      rootDir,
    });
    assert.equal(impl.versionUrl, 'https://x/v1.2%20beta');
  });

  it('external source: no manifestUrl, uses registry repoUrl as fallback', () => {
    const impl = buildImpl({
      driver: driver({ source: 'external', repoUrl: 'https://example.com/acme/engine' }),
      manifest: {},
      version: null,
      rootDir,
    });
    assert.equal(impl.manifestUrl, undefined);
    assert.equal(impl.repoUrl, 'https://example.com/acme/engine');
  });

  it('manifest.homepage wins over registry repoUrl when both present', () => {
    const impl = buildImpl({
      driver: driver({ source: 'external', repoUrl: 'https://example.com/registry-fallback' }),
      manifest: { homepage: 'https://example.com/manifest-home' },
      version: null,
      rootDir,
    });
    assert.equal(impl.repoUrl, 'https://example.com/manifest-home');
  });
});

describe('readManifestFile', () => {
  it('returns {} when the file does not exist', () => {
    assert.deepStrictEqual(readManifestFile('/tmp/nonexistent-manifest.json'), {});
  });

  it('returns {} on malformed JSON', () => {
    const p = path.join(os.tmpdir(), `manifest-bad-${Date.now()}.json`);
    fs.writeFileSync(p, 'not valid json');
    try {
      assert.deepStrictEqual(readManifestFile(p), {});
    } finally {
      fs.rmSync(p, { force: true });
    }
  });

  it('parses valid JSON', () => {
    const p = path.join(os.tmpdir(), `manifest-good-${Date.now()}.json`);
    fs.writeFileSync(p, JSON.stringify({ language: 'Kotlin' }));
    try {
      assert.deepStrictEqual(readManifestFile(p), { language: 'Kotlin' });
    } finally {
      fs.rmSync(p, { force: true });
    }
  });
});
