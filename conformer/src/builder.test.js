'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { DEFAULT_BUILD_TIMEOUT_MS, getVersion, buildImpl, getBuildTimeoutMs } = require('./builder');

describe('getVersion', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns SHA from git repo in build/', () => {
    const buildDir = path.join(tmpDir, 'build');
    execFileSync('git', ['init', '--quiet', buildDir]);
    execFileSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: buildDir });
    const expected = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: buildDir }).toString().trim();

    const sha = getVersion(tmpDir);
    assert.equal(sha, expected);
  });

  it('returns unknown when build/ does not exist', () => {
    assert.equal(getVersion(tmpDir), 'unknown');
  });

  it('returns unknown when build/ is not a git repo', () => {
    fs.mkdirSync(path.join(tmpDir, 'build'));
    assert.equal(getVersion(tmpDir), 'unknown');
  });
});

describe('buildImpl', () => {
  let tmpDir;
  let repoDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-test-'));
    // Create a bare repo to clone from
    repoDir = path.join(tmpDir, 'repo.git');
    execFileSync('git', ['init', '--quiet', '--bare', repoDir]);

    // Create a temporary working copy to make commits
    const workDir = path.join(tmpDir, 'work');
    execFileSync('git', ['clone', '--quiet', repoDir, workDir], { stdio: 'pipe' });
    execFileSync('git', ['checkout', '-b', 'main'], { cwd: workDir });
    fs.writeFileSync(path.join(workDir, 'hello.txt'), 'hello\n');
    execFileSync('git', ['add', '.'], { cwd: workDir });
    execFileSync('git', ['commit', '--quiet', '-m', 'init'], { cwd: workDir });
    execFileSync('git', ['push', '--quiet', '--set-upstream', 'origin', 'main'], { cwd: workDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('clones, builds, and writes stamp', async () => {
    const implDir = path.join(tmpDir, 'impl');
    fs.mkdirSync(implDir);
    fs.writeFileSync(path.join(implDir, 'Makefile'), '.PHONY: build\nbuild:\n\t@echo "built"\n');

    const impl = { name: 'test', path: implDir, repo: repoDir, branch: 'main' };
    const result = await buildImpl(impl, '/');

    assert.equal(result.name, 'test');
    assert.equal(result.ok, true);
    assert.ok(result.sha);
    assert.equal(result.sha.length, 40);

    // Stamp should exist
    const stamp = fs.readFileSync(path.join(implDir, '.built-sha'), 'utf8').trim();
    assert.equal(stamp, result.sha);
  });

  it('skips build when stamp matches', async () => {
    const implDir = path.join(tmpDir, 'impl');
    fs.mkdirSync(implDir);
    fs.writeFileSync(path.join(implDir, 'Makefile'), '.PHONY: build\nbuild:\n\t@echo "built"\n');

    const impl = { name: 'test', path: implDir, repo: repoDir, branch: 'main' };

    // First build
    const first = await buildImpl(impl, '/');
    assert.equal(first.ok, true);

    // Second build — should skip
    const second = await buildImpl(impl, '/');
    assert.equal(second.ok, true);
    assert.equal(second.sha, first.sha);
  });

  it('returns error when make build fails', async () => {
    const implDir = path.join(tmpDir, 'impl');
    fs.mkdirSync(implDir);
    fs.writeFileSync(path.join(implDir, 'Makefile'), '.PHONY: build\nbuild:\n\t@exit 1\n');

    const impl = { name: 'test', path: implDir, repo: repoDir, branch: 'main' };
    const result = await buildImpl(impl, '/');

    assert.equal(result.ok, false);
    assert.ok(result.error);
  });

  it('returns error when repo does not exist', async () => {
    const implDir = path.join(tmpDir, 'impl');
    fs.mkdirSync(implDir);
    fs.writeFileSync(path.join(implDir, 'Makefile'), '.PHONY: build\nbuild:\n\t@echo "built"\n');

    const impl = { name: 'test', path: implDir, repo: '/nonexistent/repo.git', branch: 'main' };
    const result = await buildImpl(impl, '/');

    assert.equal(result.ok, false);
    assert.ok(result.error);
  });

  it('returns error when branch does not exist', async () => {
    const implDir = path.join(tmpDir, 'impl');
    fs.mkdirSync(implDir);
    fs.writeFileSync(path.join(implDir, 'Makefile'), '.PHONY: build\nbuild:\n\t@echo "built"\n');

    const impl = { name: 'test', path: implDir, repo: repoDir, branch: 'missing-branch' };
    const result = await buildImpl(impl, '/');

    assert.equal(result.ok, false);
    assert.match(result.error, /missing-branch|couldn't find remote ref|not our ref/i);
  });
});

describe('getBuildTimeoutMs', () => {
  it('uses the default timeout when impl does not override it', () => {
    assert.equal(getBuildTimeoutMs({}), DEFAULT_BUILD_TIMEOUT_MS);
  });

  it('uses the impl-specific timeout override when provided', () => {
    assert.equal(getBuildTimeoutMs({ buildTimeoutMs: 1234 }), 1234);
  });
});
