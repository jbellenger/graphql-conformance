'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ResultsStore } = require('../../results');
const { getVersion } = require('./builder');
const { discoverCorpus } = require('./corpus');

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

const testConfig = {
  reference: 'graphql-js-17',
  impls: {
    'graphql-js-17': {
      path: './impls/graphql-js-17',
      command: ['node', 'index.js'],
    },
    'graphql-js-copy': {
      path: './impls/graphql-js-17',
      command: ['node', 'index.js'],
    },
  },
};

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

describe('integration: self-comparison', () => {
  it('graphql-js vs itself produces all true', () => {
    fs.writeFileSync(tmpConfigPath, JSON.stringify(testConfig, null, 2));

    const { cmd, args, opts } = runConformer();
    execFileSync(cmd, args, opts);

    const store = ResultsStore.fromDirectory(tmpResultsDir);
    const runResult = store.loadLatestRunSummary();

    assert.ok(runResult, 'should have a run result');
    assert.ok(runResult.timestamp);
    assert.equal(runResult.reference.name, 'graphql-js-17');
    assert.ok(runResult.reference.sha);
    assert.ok(runResult.conformants['graphql-js-copy']);
    assert.ok(runResult.conformants['graphql-js-copy'].sha);

    const failures = store.getImplFailures('graphql-js-copy');
    assert.equal(failures.length, 0, 'graphql-js vs itself should have no failures');
  });
});

describe('integration: incremental skip', () => {
  it('second run skips unchanged conformant and produces same results', () => {
    fs.writeFileSync(tmpConfigPath, JSON.stringify(testConfig, null, 2));

    const { cmd, args, opts } = runConformer();
    execFileSync(cmd, args, opts);

    const store1 = ResultsStore.fromDirectory(tmpResultsDir);
    const run1 = store1.loadLatestRunSummary();

    const run2proc = spawnSync(cmd, args, opts);
    assert.equal(run2proc.status, 0, 'second run should succeed');

    const stderr = run2proc.stderr.toString();
    assert.ok(stderr.includes('Skipping conformant (graphql-js-copy)'),
      'should log that conformant was skipped');

    const store2 = ResultsStore.fromDirectory(tmpResultsDir);
    const runs = store2.listRuns();
    assert.equal(runs.length, 2, 'should have two runs');

    const run2 = store2.loadLatestRun();

    assert.deepStrictEqual(
      run2.conformants['graphql-js-copy'].failuresByTestKey,
      run1.conformants['graphql-js-copy'].failuresByTestKey,
      'skipped conformant should have same test results as prior run',
    );
  });

  it('reuses failure-only skipped results without persisting passing test rows', () => {
    fs.writeFileSync(tmpConfigPath, JSON.stringify(testConfig, null, 2));

    const corpusTotal = discoverCorpus(path.join(rootDir, 'corpus')).length;
    const refSha = getVersion(path.join(rootDir, 'impls', 'graphql-js-17'));
    const conformantSha = getVersion(path.join(rootDir, 'impls', 'graphql-js-17'));
    const store = ResultsStore.fromDirectory(tmpResultsDir);
    store.recordRun({
      id: 'prior-run',
      timestamp: '2026-03-18T00:00:00.000Z',
      reference: {
        name: 'graphql-js-17',
        sha: refSha,
        scoringModel: 'runnable-set-v1',
        total: corpusTotal,
        errors: 0,
        corpusTotal,
        excluded: 0,
      },
      conformants: {
        'graphql-js-copy': {
          sha: conformantSha,
          total: corpusTotal,
          passed: corpusTotal - 1,
          failuresByTestKey: {
            '0/0': { testKey: '0/0', error: 'seeded mismatch' },
          },
        },
      },
    });

    const { cmd, args, opts } = runConformer();
    const result = spawnSync(cmd, args, opts);
    assert.equal(result.status, 0, `stderr: ${result.stderr.toString()}`);
    assert.match(result.stderr.toString(), /Skipping conformant \(graphql-js-copy\)/);

    const latestRun = ResultsStore.fromDirectory(tmpResultsDir).loadLatestRunSummary();
    assert.equal(latestRun.conformants['graphql-js-copy'].total, corpusTotal);
    assert.equal(latestRun.conformants['graphql-js-copy'].passed, corpusTotal - 1);
    assert.deepStrictEqual(
      Object.keys(latestRun.conformants['graphql-js-copy'].failuresByTestKey),
      ['0/0'],
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
