'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const SCRIPT_SOURCE = path.join(__dirname, 'copy-site-data.sh');

function writeFile(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

// Lay out a fake repo under `root` that mirrors the parts of the real
// repo that `copy-site-data.sh` touches: `scripts/`, `results/data/`,
// `corpus/`, and `site/dist/`. Returns the root so each test can set up
// its own variants (missing directories, etc.).
function makeFakeRepo(root) {
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'site/dist'), { recursive: true });
  const scriptDest = path.join(root, 'scripts', 'copy-site-data.sh');
  fs.copyFileSync(SCRIPT_SOURCE, scriptDest);
  fs.chmodSync(scriptDest, 0o755);
  return scriptDest;
}

function runScript(scriptPath) {
  execFileSync('bash', [scriptPath], { stdio: 'pipe' });
}

describe('scripts/copy-site-data.sh', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-site-data-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('copies results/data and corpus into site/dist/data', () => {
    const script = makeFakeRepo(tmpRoot);
    writeFile(path.join(tmpRoot, 'results/data/summary.json'), '{"runs":[]}');
    writeFile(
      path.join(tmpRoot, 'results/data/runs/abc/results.json'),
      '{"results":[]}',
    );
    writeFile(path.join(tmpRoot, 'corpus/0be3846f/schema.graphqls'), '# schema');
    writeFile(
      path.join(tmpRoot, 'corpus/0be3846f/0f576f46/query.graphql'),
      '# query',
    );
    writeFile(
      path.join(tmpRoot, 'corpus/0be3846f/0f576f46/44136fa3/variables.json'),
      '{}',
    );

    runScript(script);

    const distData = path.join(tmpRoot, 'site/dist/data');
    assert.equal(
      fs.readFileSync(path.join(distData, 'summary.json'), 'utf8'),
      '{"runs":[]}',
    );
    assert.equal(
      fs.readFileSync(
        path.join(distData, 'runs/abc/results.json'),
        'utf8',
      ),
      '{"results":[]}',
    );
    // Corpus must be copied so the failure-detail page's /data/corpus/*
    // fetches resolve instead of 404ing. Regression guard: the Pages
    // workflow previously omitted this copy and production returned 404
    // for every test-input fetch.
    assert.equal(
      fs.readFileSync(
        path.join(distData, 'corpus/0be3846f/schema.graphqls'),
        'utf8',
      ),
      '# schema',
    );
    assert.equal(
      fs.readFileSync(
        path.join(distData, 'corpus/0be3846f/0f576f46/query.graphql'),
        'utf8',
      ),
      '# query',
    );
    assert.equal(
      fs.readFileSync(
        path.join(
          distData,
          'corpus/0be3846f/0f576f46/44136fa3/variables.json',
        ),
        'utf8',
      ),
      '{}',
    );
  });

  it('replaces an existing corpus copy instead of merging into it', () => {
    const script = makeFakeRepo(tmpRoot);
    writeFile(path.join(tmpRoot, 'corpus/abc123/schema.graphqls'), 'new');
    // Stale case from a previous build that no longer exists in the source
    // corpus. The script removes the destination corpus dir before copying
    // so the site never serves deleted test cases.
    writeFile(
      path.join(tmpRoot, 'site/dist/data/corpus/deadbeef/schema.graphqls'),
      'stale',
    );

    runScript(script);

    const distCorpus = path.join(tmpRoot, 'site/dist/data/corpus');
    assert.equal(
      fs.readFileSync(path.join(distCorpus, 'abc123/schema.graphqls'), 'utf8'),
      'new',
    );
    assert.equal(fs.existsSync(path.join(distCorpus, 'deadbeef')), false);
  });

  it('is a no-op when results/data and corpus are absent', () => {
    const script = makeFakeRepo(tmpRoot);

    runScript(script);

    // The only thing the script should have done is create site/dist/data.
    assert.equal(fs.existsSync(path.join(tmpRoot, 'site/dist/data')), true);
    assert.deepEqual(fs.readdirSync(path.join(tmpRoot, 'site/dist/data')), []);
  });
});
