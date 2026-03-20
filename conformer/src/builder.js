'use strict';

const { execFile, execFileSync } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { getToolEnv } = require('./tools');

const execFileAsync = promisify(execFile);

const BUILD_TIMEOUT_MS = 5 * 60 * 1000;

async function buildImpl(impl, baseDir) {
  const implDir = path.resolve(baseDir, impl.path);
  const buildDir = path.join(implDir, 'build');
  const stampFile = path.join(implDir, '.built-sha');

  try {
    // Clone if not already cloned
    if (!fs.existsSync(path.join(buildDir, '.git'))) {
      await execFileAsync('git', ['clone', '--quiet', impl.repo, buildDir], { timeout: BUILD_TIMEOUT_MS });
    }

    // Fetch latest from remote
    await execFileAsync('git', ['fetch', '--all', '--quiet'], { cwd: buildDir, timeout: BUILD_TIMEOUT_MS });

    // Checkout detached HEAD at latest remote tip
    await execFileAsync('git', ['checkout', '--quiet', `origin/${impl.branch}`], { cwd: buildDir, timeout: BUILD_TIMEOUT_MS });

    // Read HEAD SHA
    const { stdout: shaOut } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: buildDir });
    const sha = shaOut.trim();

    // Check stamp — skip build if already built at this SHA
    if (fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8').trim() === sha) {
      process.stderr.write(`  ${impl.name}: already built at ${sha.slice(0, 8)}, skipping\n`);
      return { name: impl.name, sha, ok: true };
    }

    // Run make build with mise-provided environment
    process.stderr.write(`  ${impl.name}: building at ${sha.slice(0, 8)}...\n`);
    const t0 = Date.now();
    const env = getToolEnv(baseDir);
    await execFileAsync('make', ['build'], { cwd: implDir, timeout: BUILD_TIMEOUT_MS, env });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    // Write stamp on success
    fs.writeFileSync(stampFile, sha + '\n');

    process.stderr.write(`  ${impl.name}: built successfully (${elapsed}s)\n`);
    return { name: impl.name, sha, ok: true };
  } catch (err) {
    const message = err.stderr ? err.stderr.toString().trim() : err.message;
    process.stderr.write(`  ${impl.name}: build failed — ${message}\n`);
    return { name: impl.name, sha: 'unknown', ok: false, error: message };
  }
}

async function buildAll(config, baseDir) {
  const allImpls = Object.entries(config.impls).map(([name, impl]) => ({ name, ...impl }));
  const results = [];
  let i = 0;
  const concurrency = os.cpus().length;

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

module.exports = { buildImpl, buildAll, getVersion };
