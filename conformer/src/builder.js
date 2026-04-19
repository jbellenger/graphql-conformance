'use strict';

const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execFileAsync = promisify(execFile);

const DEFAULT_BUILD_TIMEOUT_MS = 5 * 60 * 1000;
const BUILD_OUTPUT_MAX_BUFFER = 32 * 1024 * 1024;
const BUILD_OUTPUT_TAIL_LINES = 40;

function tailLines(text, n) {
  const lines = String(text || '').split('\n');
  return lines.slice(-n).join('\n').replace(/\s+$/, '');
}

function getBuildTimeoutMs(impl) {
  return impl.buildTimeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS;
}

function getBuildConcurrency() {
  const raw = process.env.BUILD_CONCURRENCY;
  if (!raw) return os.cpus().length;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return os.cpus().length;
  }

  return parsed;
}

async function buildImpl(impl, baseDir) {
  const implDir = path.resolve(baseDir, impl.path);
  const buildDir = path.join(implDir, 'build');
  const stampFile = path.join(implDir, '.built-sha');
  const remoteRef = `refs/remotes/origin/${impl.branch}`;
  const timeoutMs = getBuildTimeoutMs(impl);

  try {
    // Clone if not already cloned
    if (!fs.existsSync(path.join(buildDir, '.git'))) {
      await execFileAsync('git', ['clone', '--quiet', impl.repo, buildDir], { timeout: timeoutMs });
    }

    // Fetch the target branch explicitly so checkout does not depend on the remote HEAD layout.
    await execFileAsync(
      'git',
      ['fetch', '--quiet', 'origin', `+refs/heads/${impl.branch}:${remoteRef}`],
      { cwd: buildDir, timeout: timeoutMs },
    );

    const { stdout: shaOut } = await execFileAsync('git', ['rev-parse', remoteRef], { cwd: buildDir });
    const sha = shaOut.trim();
    await execFileAsync('git', ['checkout', '--detach', '--quiet', sha], { cwd: buildDir, timeout: timeoutMs });

    // Check stamp — skip build if already built at this SHA
    if (fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8').trim() === sha) {
      process.stderr.write(`  ${impl.name}: already built at ${sha.slice(0, 8)}, skipping\n`);
      return { name: impl.name, sha, ok: true };
    }

    process.stderr.write(`  ${impl.name}: building at ${sha.slice(0, 8)}...\n`);
    const t0 = Date.now();
    await execFileAsync('make', ['build'], {
      cwd: implDir,
      timeout: timeoutMs,
      maxBuffer: BUILD_OUTPUT_MAX_BUFFER,
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    // Write stamp on success
    fs.writeFileSync(stampFile, sha + '\n');

    process.stderr.write(`  ${impl.name}: built successfully (${elapsed}s)\n`);
    return { name: impl.name, sha, ok: true };
  } catch (err) {
    const stdout = err.stdout ? err.stdout.toString() : '';
    const stderr = err.stderr ? err.stderr.toString() : '';
    const summary = (stderr || stdout || err.message || '').trim().split('\n').slice(-1)[0] || err.message;
    process.stderr.write(`  ${impl.name}: build failed — ${summary}\n`);
    return { name: impl.name, sha: 'unknown', ok: false, error: summary, stdout, stderr };
  }
}

async function buildAll(config, baseDir) {
  const allImpls = Object.entries(config.impls).map(([name, impl]) => ({ name, ...impl }));
  const results = [];
  let i = 0;
  const concurrency = Math.min(getBuildConcurrency(), Math.max(allImpls.length, 1));

  async function next() {
    while (i < allImpls.length) {
      const impl = allImpls[i++];
      results.push(await buildImpl(impl, baseDir));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => next()));
  return results;
}

function getVersion(implDir) {
  const buildDir = path.join(implDir, 'build');
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: buildDir, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

module.exports = {
  DEFAULT_BUILD_TIMEOUT_MS,
  BUILD_OUTPUT_TAIL_LINES,
  buildImpl,
  buildAll,
  getBuildConcurrency,
  getBuildTimeoutMs,
  getVersion,
  tailLines,
};
