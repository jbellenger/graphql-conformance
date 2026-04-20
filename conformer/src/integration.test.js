'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ResultsStore } = require('../../results');
const { discoverCorpus } = require('./corpus');
const { computeCorpusFingerprint } = require('./index');

const baseDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(baseDir, '..');

let tmpDir;
let tmpResultsDir;
let tmpConfigPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conformer-integration-'));
  tmpResultsDir = path.join(tmpDir, 'results');
  fs.mkdirSync(tmpResultsDir);
  tmpConfigPath = path.join(tmpDir, 'config.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runConformer(env = {}) {
  return {
    cmd: 'node',
    args: [path.join(baseDir, 'src/index.js')],
    opts: {
      cwd: baseDir,
      timeout: 300_000,
      env: { ...process.env, RESULTS_DIR: tmpResultsDir, CONFIG_PATH: tmpConfigPath, ...env },
    },
  };
}

function writeCorpusCase(corpusDir, testId, queryId, schema, query, variables) {
  const caseDir = path.join(corpusDir, testId, queryId);
  fs.mkdirSync(caseDir, { recursive: true });
  fs.writeFileSync(path.join(corpusDir, testId, 'schema.graphqls'), schema);
  fs.writeFileSync(path.join(caseDir, 'query.graphql'), query);
  if (variables) {
    const varsDir = path.join(caseDir, 'vars');
    fs.mkdirSync(varsDir, { recursive: true });
    fs.writeFileSync(path.join(varsDir, 'variables.json'), JSON.stringify(variables));
  }
}

function writeNodeImpl(dir, source) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.js'), source);
}

function writeProtocolImpl(dir, eventsSource) {
  writeNodeImpl(dir, `'use strict';
const events = ${eventsSource};
for (const event of events) {
  process.stdout.write(JSON.stringify(event) + '\\n');
}
`);
}

function writeStaticJsonImpl(dir, resultSource) {
  writeNodeImpl(dir, `'use strict';
process.stdout.write(JSON.stringify(${resultSource}));
`);
}

describe('integration: self-comparison', () => {
  it('graphql-js vs itself produces all true', () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    const refDir = path.join(tmpDir, 'ref-impl');
    const conformantDir = path.join(tmpDir, 'conformant-impl');

    writeCorpusCase(
      corpusDir,
      'ok-test',
      'ok-query',
      'type Query { ok: String }',
      '{ ok }',
    );
    writeStaticJsonImpl(refDir, `{ data: { ok: 'value' } }`);
    writeStaticJsonImpl(conformantDir, `{ data: { ok: 'value' } }`);

    fs.writeFileSync(tmpConfigPath, JSON.stringify({
      reference: 'ref',
      impls: {
        ref: {
          path: refDir,
          command: ['node', 'index.js'],
        },
        conformant: {
          path: conformantDir,
          command: ['node', 'index.js'],
        },
      },
    }, null, 2));

    const { cmd, args, opts } = runConformer({ CORPUS_DIR: corpusDir });
    execFileSync(cmd, args, opts);

    const store = ResultsStore.fromDirectory(tmpResultsDir);
    const runResult = store.loadLatestRunSummary();

    assert.ok(runResult, 'should have a run result');
    assert.ok(runResult.timestamp);
    assert.equal(runResult.reference.name, 'ref');
    assert.ok(runResult.reference.sha);
    assert.ok(runResult.conformants.conformant);
    assert.ok(runResult.conformants.conformant.sha);

    const failures = store.getImplFailures('conformant');
    assert.equal(failures.length, 0, 'identical temp impls should have no failures');
  });
});

describe('integration: incremental skip', () => {
  it('second run skips unchanged conformant and produces same results', () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    const refDir = path.join(tmpDir, 'ref-impl');
    const conformantDir = path.join(tmpDir, 'conformant-impl');

    writeCorpusCase(
      corpusDir,
      'ok-test',
      'ok-query',
      'type Query { ok: String }',
      '{ ok }',
    );
    writeStaticJsonImpl(refDir, `{ data: { ok: 'value' } }`);
    writeStaticJsonImpl(conformantDir, `{ data: { ok: 'value' } }`);

    fs.writeFileSync(tmpConfigPath, JSON.stringify({
      reference: 'ref',
      impls: {
        ref: {
          path: refDir,
          command: ['node', 'index.js'],
        },
        conformant: {
          path: conformantDir,
          command: ['node', 'index.js'],
        },
      },
    }, null, 2));

    const { cmd, args, opts } = runConformer({ CORPUS_DIR: corpusDir });
    execFileSync(cmd, args, opts);

    const store1 = ResultsStore.fromDirectory(tmpResultsDir);
    const run1 = store1.loadLatestRunSummary();

    const run2proc = spawnSync(cmd, args, opts);
    assert.equal(run2proc.status, 0, 'second run should succeed');

    const stderr = run2proc.stderr.toString();
    assert.ok(stderr.includes('Skipping conformant (conformant)'),
      'should log that conformant was skipped');

    const store2 = ResultsStore.fromDirectory(tmpResultsDir);
    const runs = store2.listRuns();
    assert.equal(runs.length, 2, 'should have two runs');

    const run2 = store2.loadLatestRun();

    assert.deepStrictEqual(
      run2.conformants.conformant.failuresByTestKey,
      run1.conformants.conformant.failuresByTestKey,
      'skipped conformant should have same test results as prior run',
    );
  });

  it('reuses failure-only skipped results without persisting passing test rows', () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    const refDir = path.join(tmpDir, 'ref-impl');
    const conformantDir = path.join(tmpDir, 'conformant-impl');

    writeCorpusCase(
      corpusDir,
      'ok-test',
      'ok-query',
      'type Query { ok: String }',
      '{ ok }',
    );
    writeStaticJsonImpl(refDir, `{ data: { ok: 'value' } }`);
    writeStaticJsonImpl(conformantDir, `{ data: { ok: 'value' } }`);

    fs.writeFileSync(tmpConfigPath, JSON.stringify({
      reference: 'ref',
      impls: {
        ref: {
          path: refDir,
          command: ['node', 'index.js'],
        },
        conformant: {
          path: conformantDir,
          command: ['node', 'index.js'],
        },
      },
    }, null, 2));

    const discoveredTests = discoverCorpus(corpusDir);
    const corpusTotal = discoveredTests.length;
    const corpusFingerprint = computeCorpusFingerprint(discoveredTests);
    const store = ResultsStore.fromDirectory(tmpResultsDir);
    store.recordRun({
      id: 'prior-run',
      timestamp: '2026-03-18T00:00:00.000Z',
      reference: {
        name: 'ref',
        sha: 'unknown',
        scoringModel: 'runnable-set-v1',
        total: corpusTotal,
        errors: 0,
        corpusTotal,
        corpusFingerprint,
        excluded: 0,
      },
      conformants: {
        conformant: {
          sha: 'unknown',
          total: corpusTotal,
          passed: 0,
          failuresByTestKey: {
            'ok-test/ok-query': { testKey: 'ok-test/ok-query', error: 'seeded mismatch' },
          },
        },
      },
    });

    const { cmd, args, opts } = runConformer({ CORPUS_DIR: corpusDir });
    const result = spawnSync(cmd, args, opts);
    assert.equal(result.status, 0, `stderr: ${result.stderr.toString()}`);
    assert.match(result.stderr.toString(), /Skipping conformant \(conformant\)/);

    const latestRun = ResultsStore.fromDirectory(tmpResultsDir).loadLatestRunSummary();
    assert.equal(latestRun.conformants.conformant.total, corpusTotal);
    assert.equal(latestRun.conformants.conformant.passed, 0);
    assert.deepStrictEqual(
      Object.keys(latestRun.conformants.conformant.failuresByTestKey),
      ['ok-test/ok-query'],
    );
  });
});

describe('integration: corpus change invalidates skip', () => {
  it('re-runs all conformants when the corpus grows', () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    const refDir = path.join(tmpDir, 'ref-impl');
    const conformantDir = path.join(tmpDir, 'conformant-impl');
    const conformantLog = path.join(tmpDir, 'conformant.log');

    writeCorpusCase(
      corpusDir,
      'ok-test',
      'ok-query',
      'type Query { ok: String }',
      '{ ok }',
    );

    writeStaticJsonImpl(refDir, `{ data: { ok: 'value' } }`);
    writeNodeImpl(conformantDir, `'use strict';
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(conformantLog)}, process.argv[3] + '\\n');
process.stdout.write(JSON.stringify({ data: { ok: 'value' } }));
`);

    fs.writeFileSync(tmpConfigPath, JSON.stringify({
      reference: 'ref',
      impls: {
        ref: { path: refDir, command: ['node', 'index.js'] },
        conformant: { path: conformantDir, command: ['node', 'index.js'] },
      },
    }, null, 2));

    const { cmd, args, opts } = runConformer({ CORPUS_DIR: corpusDir });
    execFileSync(cmd, args, opts);

    const run1 = ResultsStore.fromDirectory(tmpResultsDir).loadLatestRunSummary();
    assert.ok(run1.reference.corpusFingerprint, 'first run should record a fingerprint');
    assert.equal(run1.conformants.conformant.total, 1);

    // Grow the corpus — conformant sha is unchanged so the old skip predicate
    // would have skipped it, but the new corpus invalidates that.
    writeCorpusCase(
      corpusDir,
      'ok-test-2',
      'ok-query',
      'type Query { ok: String }',
      '{ ok }',
    );

    fs.rmSync(conformantLog, { force: true });

    const run2proc = spawnSync(cmd, args, opts);
    assert.equal(run2proc.status, 0, `stderr: ${run2proc.stderr.toString()}`);
    const stderr = run2proc.stderr.toString();
    assert.match(stderr, /Corpus changed since prior run/);
    assert.ok(!stderr.includes('Skipping conformant'),
      'conformant must not be skipped when corpus changed');

    const run2 = ResultsStore.fromDirectory(tmpResultsDir).loadLatestRunSummary();
    assert.equal(run2.conformants.conformant.total, 2,
      'conformant total should reflect the new corpus size');
    assert.notEqual(run2.reference.corpusFingerprint, run1.reference.corpusFingerprint);
    assert.ok(fs.existsSync(conformantLog), 'conformant should have actually run');
  });
});

describe('integration: object-ordering quirk', () => {
  it('marks a conformant with different key order as matching with quirk', () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    const refDir = path.join(tmpDir, 'ref-impl');
    const conformantDir = path.join(tmpDir, 'conformant-impl');

    writeCorpusCase(
      corpusDir,
      'ordering-test',
      'ordering-query',
      'type Query { a: String b: String }',
      '{ a b }',
    );
    writeStaticJsonImpl(refDir, `{ data: { a: 'x', b: 'y' } }`);
    writeStaticJsonImpl(conformantDir, `{ data: { b: 'y', a: 'x' } }`);

    fs.writeFileSync(tmpConfigPath, JSON.stringify({
      reference: 'ref',
      impls: {
        ref: { path: refDir, command: ['node', 'index.js'] },
        conformant: { path: conformantDir, command: ['node', 'index.js'] },
      },
    }, null, 2));

    const { cmd, args, opts } = runConformer({ CORPUS_DIR: corpusDir });
    execFileSync(cmd, args, opts);

    const run = ResultsStore.fromDirectory(tmpResultsDir).loadLatestRunSummary();
    assert.equal(run.conformants.conformant.passed, 1);
    assert.deepStrictEqual(
      run.conformants.conformant.quirksByTestKey,
      { 'ordering-test/ordering-query': ['object-ordering'] },
    );
  });
});

describe('integration: reference exclusions', () => {
  it('excludes reference-crash cases and does not run conformants for them', () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    const refDir = path.join(tmpDir, 'ref-impl');
    const conformantDir = path.join(tmpDir, 'conformant-impl');
    const conformantLog = path.join(tmpDir, 'conformant.log');

    writeCorpusCase(
      corpusDir,
      'ok-test',
      'ok-query',
      'type Query { ok: String }',
      '{ ok }',
    );
    writeCorpusCase(
      corpusDir,
      'excluded-test',
      'excluded-query',
      'type Query { boom: String }',
      '{ boom }',
    );

    writeNodeImpl(refDir, `'use strict';
const fs = require('fs');
const queryPath = process.argv[3];
if (queryPath.includes('excluded-test')) {
  process.stderr.write('reference exploded\\n');
  process.exit(1);
}
process.stdout.write(JSON.stringify({ data: { ok: 'value' } }));
`);

    writeNodeImpl(conformantDir, `'use strict';
const fs = require('fs');
const logPath = ${JSON.stringify(conformantLog)};
fs.appendFileSync(logPath, process.argv[3] + '\\n');
process.stdout.write(JSON.stringify({ data: { ok: 'value' } }));
`);

    fs.writeFileSync(tmpConfigPath, JSON.stringify({
      reference: 'ref',
      impls: {
        ref: {
          path: refDir,
          command: ['node', 'index.js'],
        },
        conformant: {
          path: conformantDir,
          command: ['node', 'index.js'],
        },
      },
    }, null, 2));

    const { cmd, args, opts } = runConformer({ CORPUS_DIR: corpusDir });
    execFileSync(cmd, args, opts);

    const store = ResultsStore.fromDirectory(tmpResultsDir);
    const run = store.loadLatestRunSummary();

    assert.equal(run.reference.total, 1);
    assert.equal(run.reference.excluded, 1);
    assert.equal(run.reference.corpusTotal, 2);
    assert.equal(run.reference.exclusions.length, 1);
    assert.equal(run.reference.exclusions[0].testKey, 'excluded-test/excluded-query');

    const conformant = run.conformants.conformant;
    assert.equal(conformant.total, 1);
    assert.equal(conformant.passed, 1);
    assert.deepStrictEqual(Object.keys(conformant.failuresByTestKey), []);

    const invocations = fs.readFileSync(conformantLog, 'utf8').trim().split('\n');
    assert.deepStrictEqual(invocations, [path.join(corpusDir, 'ok-test', 'ok-query', 'query.graphql')]);
  });

  it('reuses prior reference exclusions when all conformants are skipped', () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    const refDir = path.join(tmpDir, 'ref-impl');
    const conformantDir = path.join(tmpDir, 'conformant-impl');
    const refLog = path.join(tmpDir, 'ref.log');
    const conformantLog = path.join(tmpDir, 'conformant.log');

    writeCorpusCase(
      corpusDir,
      'ok-test',
      'ok-query',
      'type Query { ok: String }',
      '{ ok }',
    );
    writeCorpusCase(
      corpusDir,
      'excluded-test',
      'excluded-query',
      'type Query { boom: String }',
      '{ boom }',
    );

    writeNodeImpl(refDir, `'use strict';
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(refLog)}, 'ran\\n');
process.stdout.write(JSON.stringify({ data: { ok: 'value' } }));
`);

    writeNodeImpl(conformantDir, `'use strict';
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(conformantLog)}, 'ran\\n');
process.stdout.write(JSON.stringify({ data: { ok: 'value' } }));
`);

    fs.writeFileSync(tmpConfigPath, JSON.stringify({
      reference: 'ref',
      impls: {
        ref: {
          path: refDir,
          command: ['node', 'index.js'],
        },
        conformant: {
          path: conformantDir,
          command: ['node', 'index.js'],
        },
      },
    }, null, 2));

    const discoveredTests2 = discoverCorpus(corpusDir);
    const corpusFingerprint2 = computeCorpusFingerprint(discoveredTests2);
    ResultsStore.fromDirectory(tmpResultsDir).recordRun({
      id: 'prior-run',
      timestamp: '2026-03-18T00:00:00.000Z',
      reference: {
        name: 'ref',
        sha: 'unknown',
        scoringModel: 'runnable-set-v1',
        total: 1,
        errors: 0,
        corpusTotal: 2,
        corpusFingerprint: corpusFingerprint2,
        excluded: 1,
        exclusions: [{ testKey: 'excluded-test/excluded-query', error: 'process exited with code 1' }],
      },
      conformants: {
        conformant: {
          sha: 'unknown',
          total: 1,
          passed: 1,
        },
      },
    });

    const { cmd, args, opts } = runConformer({ CORPUS_DIR: corpusDir });
    const result = spawnSync(cmd, args, opts);
    assert.equal(result.status, 0, `stderr: ${result.stderr.toString()}`);
    assert.match(result.stderr.toString(), /All conformants unchanged, skipping test execution/);

    const latestRun = ResultsStore.fromDirectory(tmpResultsDir).loadLatestRunSummary();
    assert.equal(latestRun.reference.total, 1);
    assert.equal(latestRun.reference.excluded, 1);
    assert.equal(latestRun.reference.exclusions.length, 1);
    assert.equal(latestRun.reference.exclusions[0].testKey, 'excluded-test/excluded-query');

    assert.ok(!fs.existsSync(refLog), 'reference should not run when reusing prior reference exclusions');
    assert.ok(!fs.existsSync(conformantLog), 'conformant should not run when skipped');
  });
});

describe('integration: streamed protocol', () => {
  it('normalizes a streamed reference result before scoring a legacy conformant', () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    const refDir = path.join(tmpDir, 'ref-impl');
    const conformantDir = path.join(tmpDir, 'conformant-impl');

    writeCorpusCase(
      corpusDir,
      'streamed-test',
      'streamed-query',
      'type Query { hero: Hero feed: [String] } type Hero { name: String }',
      '{ hero { name } feed }',
    );

    writeProtocolImpl(refDir, `[
  { protocol: 'conformer-stream-v1', kind: 'initial', data: { hero: {}, feed: [] } },
  { protocol: 'conformer-stream-v1', kind: 'patch', path: ['hero'], data: { name: 'str' } },
  { protocol: 'conformer-stream-v1', kind: 'patch', path: ['feed'], items: ['a', 'b'] },
  { protocol: 'conformer-stream-v1', kind: 'complete' },
]`);

    writeNodeImpl(conformantDir, `'use strict';
process.stdout.write(JSON.stringify({
  data: {
    hero: { name: 'str' },
    feed: ['a', 'b'],
  },
}));
`);

    fs.writeFileSync(tmpConfigPath, JSON.stringify({
      reference: 'ref',
      impls: {
        ref: {
          path: refDir,
          command: ['node', 'index.js'],
        },
        conformant: {
          path: conformantDir,
          command: ['node', 'index.js'],
        },
      },
    }, null, 2));

    const { cmd, args, opts } = runConformer({ CORPUS_DIR: corpusDir });
    execFileSync(cmd, args, opts);

    const run = ResultsStore.fromDirectory(tmpResultsDir).loadLatestRunSummary();
    assert.equal(run.reference.total, 1);
    assert.equal(run.reference.excluded, 0);
    assert.equal(run.conformants.conformant.total, 1);
    assert.equal(run.conformants.conformant.passed, 1);
    assert.deepStrictEqual(run.conformants.conformant.failuresByTestKey, {});
  });

  it('stores assembled expected and actual results when streamed outputs differ', () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    const refDir = path.join(tmpDir, 'ref-impl');
    const conformantDir = path.join(tmpDir, 'conformant-impl');

    writeCorpusCase(
      corpusDir,
      'streamed-test',
      'streamed-query',
      'type Query { hero: Hero feed: [String] } type Hero { name: String }',
      '{ hero { name } feed }',
    );

    writeProtocolImpl(refDir, `[
  { protocol: 'conformer-stream-v1', kind: 'initial', data: { hero: {}, feed: [] } },
  { protocol: 'conformer-stream-v1', kind: 'patch', path: ['hero'], data: { name: 'str' } },
  { protocol: 'conformer-stream-v1', kind: 'patch', path: ['feed'], items: ['a', 'b'] },
  { protocol: 'conformer-stream-v1', kind: 'complete' },
]`);

    writeProtocolImpl(conformantDir, `[
  { protocol: 'conformer-stream-v1', kind: 'initial', data: { hero: {}, feed: [] } },
  { protocol: 'conformer-stream-v1', kind: 'patch', path: ['hero'], data: { name: 'wrong' } },
  { protocol: 'conformer-stream-v1', kind: 'patch', path: ['feed'], items: ['a', 'c'] },
  { protocol: 'conformer-stream-v1', kind: 'complete' },
]`);

    fs.writeFileSync(tmpConfigPath, JSON.stringify({
      reference: 'ref',
      impls: {
        ref: {
          path: refDir,
          command: ['node', 'index.js'],
        },
        conformant: {
          path: conformantDir,
          command: ['node', 'index.js'],
        },
      },
    }, null, 2));

    const { cmd, args, opts } = runConformer({ CORPUS_DIR: corpusDir });
    execFileSync(cmd, args, opts);

    const failures = ResultsStore.fromDirectory(tmpResultsDir).getImplFailures('conformant');
    assert.equal(failures.length, 1);
    assert.deepStrictEqual(failures[0].expected, {
      data: {
        hero: { name: 'str' },
        feed: ['a', 'b'],
      },
    });
    assert.deepStrictEqual(failures[0].actual, {
      data: {
        hero: { name: 'wrong' },
        feed: ['a', 'c'],
      },
    });
  });

  it('treats malformed streamed reference output as excluded and skips conformants', () => {
    const corpusDir = path.join(tmpDir, 'corpus');
    const refDir = path.join(tmpDir, 'ref-impl');
    const conformantDir = path.join(tmpDir, 'conformant-impl');
    const conformantLog = path.join(tmpDir, 'conformant.log');

    writeCorpusCase(
      corpusDir,
      'streamed-test',
      'streamed-query',
      'type Query { hero: Hero } type Hero { name: String }',
      '{ hero { name } }',
    );

    writeProtocolImpl(refDir, `[
  { protocol: 'conformer-stream-v1', kind: 'initial', data: { hero: {} } },
  { protocol: 'conformer-stream-v1', kind: 'patch', path: ['hero'], data: { name: 'str' } },
]`);

    writeNodeImpl(conformantDir, `'use strict';
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(conformantLog)}, 'ran\\n');
process.stdout.write(JSON.stringify({ data: { hero: { name: 'str' } } }));
`);

    fs.writeFileSync(tmpConfigPath, JSON.stringify({
      reference: 'ref',
      impls: {
        ref: {
          path: refDir,
          command: ['node', 'index.js'],
        },
        conformant: {
          path: conformantDir,
          command: ['node', 'index.js'],
        },
      },
    }, null, 2));

    const { cmd, args, opts } = runConformer({ CORPUS_DIR: corpusDir });
    execFileSync(cmd, args, opts);

    const run = ResultsStore.fromDirectory(tmpResultsDir).loadLatestRunSummary();
    assert.equal(run.reference.total, 0);
    assert.equal(run.reference.excluded, 1);
    assert.equal(run.reference.exclusions.length, 1);
    assert.equal(run.reference.exclusions[0].error, 'invalid protocol output');
    assert.ok(!fs.existsSync(conformantLog), 'conformant should not run for excluded streamed cases');
  });
});
