'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ResultsStore } = require('../results');

const buildScript = path.join(__dirname, 'build.js');

let tmpResultsDir;
let tmpSiteDataDir;

beforeEach(() => {
  tmpResultsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-build-results-'));
  tmpSiteDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-build-data-'));
});

afterEach(() => {
  fs.rmSync(tmpResultsDir, { recursive: true, force: true });
  fs.rmSync(tmpSiteDataDir, { recursive: true, force: true });
});

function seedResults(overrides = {}) {
  const store = ResultsStore.fromDirectory(tmpResultsDir);
  store.recordRun({
    id: overrides.id || 'run-1',
    timestamp: overrides.timestamp || '2026-03-19T00:00:00.000Z',
    reference: {
      name: 'graphql-js',
      version: '1.2.3',
      imageDigest: 'sha256:abc123',
      total: 2,
      errors: 0,
      corpusTotal: 2,
      excluded: 0,
    },
    conformants: overrides.conformants || {
      'impl-a': {
        version: '4.5.6',
        imageDigest: 'sha256:def456',
        tests: {
          'x/y/z': { matches: true },
          'a/b/c': { matches: false },
        },
      },
    },
  });
}

describe('site/build.js', () => {
  it('produces summary.json with correct structure', () => {
    seedResults();
    execFileSync('node', [buildScript, tmpResultsDir], {
      env: { ...process.env, SITE_DATA_DIR: tmpSiteDataDir },
    });

    const summary = JSON.parse(fs.readFileSync(path.join(tmpSiteDataDir, 'summary.json'), 'utf8'));
    assert.equal(summary.length, 2);

    const ref = summary.find((s) => s.impl === 'graphql-js');
    assert.ok(ref, 'should include reference impl');
    assert.equal(ref.total, 2);
    assert.equal(ref.failed, 0);
    assert.equal(ref.passPct, 100);
    assert.equal(ref.excluded, 0);
    assert.equal(ref.corpusTotal, 2);
    assert.equal(ref.version, '1.2.3');
    assert.equal(ref.isReference, true);
    assert.ok('versionUrl' in ref);

    const implA = summary.find((s) => s.impl === 'impl-a');
    assert.ok(implA, 'should include conformant impl');
    assert.equal(implA.total, 2);
    assert.equal(implA.failed, 1);
    assert.equal(implA.passPct, 50);
    assert.equal(implA.version, '4.5.6');
    assert.ok(implA.repo !== undefined);
    assert.ok('versionUrl' in implA);
  });

  it('resolves versionUrl from manifest template for a registered impl', () => {
    const store = ResultsStore.fromDirectory(tmpResultsDir);
    store.recordRun({
      id: 'run-versionurl',
      timestamp: '2026-03-19T00:00:00.000Z',
      reference: {
        name: 'graphql-js-17',
        version: '17.0.0-alpha.14',
        imageDigest: 'sha256:ref',
        total: 1,
        errors: 0,
        corpusTotal: 1,
        excluded: 0,
      },
      conformants: {
        'graphql-java': {
          version: '25.0',
          imageDigest: 'sha256:java',
          tests: { 'x/y/z': { matches: true } },
        },
      },
    });
    execFileSync('node', [buildScript, tmpResultsDir], {
      env: { ...process.env, SITE_DATA_DIR: tmpSiteDataDir },
    });
    const summary = JSON.parse(fs.readFileSync(path.join(tmpSiteDataDir, 'summary.json'), 'utf8'));
    const ref = summary.find((s) => s.impl === 'graphql-js-17');
    assert.equal(
      ref.versionUrl,
      'https://github.com/graphql/graphql-js/releases/tag/v17.0.0-alpha.14',
    );
    const java = summary.find((s) => s.impl === 'graphql-java');
    assert.equal(
      java.versionUrl,
      'https://github.com/graphql-java/graphql-java/releases/tag/v25.0',
    );
  });

  it('url-encodes version values substituted into versionUrl templates', () => {
    const store = ResultsStore.fromDirectory(tmpResultsDir);
    store.recordRun({
      id: 'run-versionurl-encode',
      timestamp: '2026-03-19T00:00:00.000Z',
      reference: {
        name: 'graphql-js-17',
        version: '17.0.0+build/1',
        imageDigest: 'sha256:ref',
        total: 1,
        errors: 0,
        corpusTotal: 1,
        excluded: 0,
      },
      conformants: {},
    });
    execFileSync('node', [buildScript, tmpResultsDir], {
      env: { ...process.env, SITE_DATA_DIR: tmpSiteDataDir },
    });
    const summary = JSON.parse(fs.readFileSync(path.join(tmpSiteDataDir, 'summary.json'), 'utf8'));
    const ref = summary.find((s) => s.impl === 'graphql-js-17');
    // Both `+` and `/` must be URL-encoded so the tag URL parses unambiguously.
    assert.equal(
      ref.versionUrl,
      'https://github.com/graphql/graphql-js/releases/tag/v17.0.0%2Bbuild%2F1',
    );
  });

  it('renders summary with null version as null (shown as "unknown" on dashboard)', () => {
    const store = ResultsStore.fromDirectory(tmpResultsDir);
    store.recordRun({
      id: 'run-missing-version',
      timestamp: '2026-03-19T00:00:00.000Z',
      reference: {
        name: 'graphql-js',
        version: null,
        imageDigest: 'sha256:abc123',
        total: 1,
        errors: 0,
        corpusTotal: 1,
        excluded: 0,
      },
      conformants: {
        'impl-a': {
          version: null,
          imageDigest: 'sha256:def456',
          tests: { 'x/y/z': { matches: true } },
        },
      },
    });
    execFileSync('node', [buildScript, tmpResultsDir], {
      env: { ...process.env, SITE_DATA_DIR: tmpSiteDataDir },
    });
    const summary = JSON.parse(fs.readFileSync(path.join(tmpSiteDataDir, 'summary.json'), 'utf8'));
    const ref = summary.find((s) => s.impl === 'graphql-js');
    assert.equal(ref.version, null);
    assert.equal(ref.versionUrl, null);
    const implA = summary.find((s) => s.impl === 'impl-a');
    assert.equal(implA.version, null);
    assert.equal(implA.versionUrl, null);
  });

  it('produces per-impl history.json and failures.json', () => {
    seedResults();
    execFileSync('node', [buildScript, tmpResultsDir], {
      env: { ...process.env, SITE_DATA_DIR: tmpSiteDataDir },
    });

    const history = JSON.parse(
      fs.readFileSync(path.join(tmpSiteDataDir, 'impls', 'impl-a', 'history.json'), 'utf8')
    );
    assert.equal(history.length, 1);
    assert.equal(history[0].date, '2026-03-19');
    assert.equal(history[0].passPct, 50);

    const failures = JSON.parse(
      fs.readFileSync(path.join(tmpSiteDataDir, 'impls', 'impl-a', 'failures.json'), 'utf8')
    );
    assert.equal(failures.length, 1);
    assert.equal(failures[0].testKey, 'a/b/c');

    // Reference impl should also get data files
    const refHistory = JSON.parse(
      fs.readFileSync(path.join(tmpSiteDataDir, 'impls', 'graphql-js', 'history.json'), 'utf8')
    );
    assert.equal(refHistory.length, 1);
    assert.equal(refHistory[0].passPct, 100);
    assert.equal(refHistory[0].failed, 0);
    assert.equal(refHistory[0].excluded, 0);

    const refFailures = JSON.parse(
      fs.readFileSync(path.join(tmpSiteDataDir, 'impls', 'graphql-js', 'failures.json'), 'utf8')
    );
    assert.deepStrictEqual(refFailures, []);

    const refExclusions = JSON.parse(
      fs.readFileSync(path.join(tmpSiteDataDir, 'impls', 'graphql-js', 'exclusions.json'), 'utf8')
    );
    assert.deepStrictEqual(refExclusions, []);
  });

  it('shows reference exclusions separately when the reference excludes some tests', () => {
    const store = ResultsStore.fromDirectory(tmpResultsDir);
    store.recordRun({
      id: 'run-ref-errors',
      timestamp: '2026-03-19T00:00:00.000Z',
      reference: {
        name: 'graphql-js',
        version: '1.2.3',
        imageDigest: 'sha256:abc123',
        total: 3,
        errors: 0,
        corpusTotal: 5,
        excluded: 2,
        exclusions: [
          { testKey: 'p/q/r', error: 'stack overflow' },
          { testKey: 's/t/u', error: 'process exited with code 1' },
        ],
      },
      conformants: {
        'impl-a': {
          version: '4.5.6',
          imageDigest: 'sha256:def456',
          tests: {
            'x/y/z': { matches: true },
          },
        },
      },
    });
    execFileSync('node', [buildScript, tmpResultsDir], {
      env: { ...process.env, SITE_DATA_DIR: tmpSiteDataDir },
    });

    const summary = JSON.parse(fs.readFileSync(path.join(tmpSiteDataDir, 'summary.json'), 'utf8'));
    const ref = summary.find((s) => s.impl === 'graphql-js');
    assert.equal(ref.total, 3);
    assert.equal(ref.failed, 0);
    assert.equal(ref.excluded, 2);
    assert.equal(ref.corpusTotal, 5);
    assert.equal(ref.passPct, 100);

    // Reference failures remain empty; exclusions are stored separately.
    const refFailures = JSON.parse(
      fs.readFileSync(path.join(tmpSiteDataDir, 'impls', 'graphql-js', 'failures.json'), 'utf8')
    );
    assert.deepStrictEqual(refFailures, []);

    const refExclusions = JSON.parse(
      fs.readFileSync(path.join(tmpSiteDataDir, 'impls', 'graphql-js', 'exclusions.json'), 'utf8')
    );
    assert.equal(refExclusions.length, 2);
    assert.equal(refExclusions[0].testKey, 'p/q/r');
    assert.equal(refExclusions[0].error, 'stack overflow');
    assert.equal(refExclusions[1].testKey, 's/t/u');
  });

  it('preserves errors and stderr on reference exclusions for a test-ref impl', () => {
    const store = ResultsStore.fromDirectory(tmpResultsDir);
    store.recordRun({
      id: 'run-ref-details',
      timestamp: '2026-03-19T00:00:00.000Z',
      reference: {
        name: 'test-ref',
        version: '0.0.1',
        imageDigest: 'sha256:testref',
        total: 0,
        errors: 0,
        corpusTotal: 2,
        excluded: 2,
        exclusions: [
          {
            testKey: 'p/q/r',
            error: 'reference returned errors',
            errors: [
              {
                message: 'Argument "@defer(label:)" must be a static string.',
                locations: [{ line: 12, column: 17 }],
              },
            ],
          },
          {
            testKey: 's/t/u',
            error: 'driver returned status 500',
            stderr: 'panic: oops\nat main.go:42',
          },
        ],
      },
      conformants: {},
    });
    execFileSync('node', [buildScript, tmpResultsDir], {
      env: { ...process.env, SITE_DATA_DIR: tmpSiteDataDir },
    });

    const refExclusions = JSON.parse(
      fs.readFileSync(path.join(tmpSiteDataDir, 'impls', 'test-ref', 'exclusions.json'), 'utf8')
    );
    assert.equal(refExclusions.length, 2);

    const withErrors = refExclusions.find((e) => e.testKey === 'p/q/r');
    assert.ok(Array.isArray(withErrors.errors));
    assert.equal(withErrors.errors.length, 1);
    assert.equal(
      withErrors.errors[0].message,
      'Argument "@defer(label:)" must be a static string.',
    );
    assert.deepStrictEqual(withErrors.errors[0].locations, [{ line: 12, column: 17 }]);

    const withStderr = refExclusions.find((e) => e.testKey === 's/t/u');
    assert.equal(withStderr.stderr, 'panic: oops\nat main.go:42');
  });

  it('exits with error when no runs exist', () => {
    assert.throws(() => {
      execFileSync('node', [buildScript, tmpResultsDir], {
        env: { ...process.env, SITE_DATA_DIR: tmpSiteDataDir },
        stdio: 'pipe',
      });
    });
  });
});
