'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function externalCacheDir() {
  return process.env.EXTERNAL_DRIVER_CACHE
    || path.join(os.tmpdir(), 'conformer-external-drivers');
}

function cloneExternalDriver(entry) {
  if (!entry.repoUrl) throw new Error(`driver ${entry.name}: external source requires "repoUrl"`);
  const ref = entry.ref || 'main';
  const slug = crypto.createHash('sha256').update(`${entry.repoUrl}@${ref}`).digest('hex').slice(0, 12);
  const checkoutDir = path.join(externalCacheDir(), `${entry.name}-${slug}`);
  fs.mkdirSync(path.dirname(checkoutDir), { recursive: true });

  if (!fs.existsSync(path.join(checkoutDir, '.git'))) {
    execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', ref, entry.repoUrl, checkoutDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } else {
    execFileSync('git', ['fetch', '--quiet', '--depth', '1', 'origin', ref], {
      cwd: checkoutDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSync('git', ['checkout', '--quiet', 'FETCH_HEAD'], {
      cwd: checkoutDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  return checkoutDir;
}

function resolveInTreeEntry(entry, rootDir, configFallback) {
  const manifestRel = entry.manifestPath || `./impls/${entry.name}/manifest.json`;
  const manifestFile = path.resolve(rootDir, manifestRel);
  const implDir = path.dirname(manifestFile);

  if (fs.existsSync(manifestFile)) {
    return {
      name: entry.name,
      source: 'in-tree',
      transport: 'http',
      implDir,
      manifestPath: manifestFile,
    };
  }

  if (configFallback && configFallback.impls && configFallback.impls[entry.name]) {
    const impl = configFallback.impls[entry.name];
    return {
      name: entry.name,
      source: 'in-tree',
      transport: 'subprocess',
      implDir: path.resolve(rootDir, impl.path),
      command: impl.command,
      buildTimeoutMs: impl.buildTimeoutMs,
    };
  }

  throw new Error(
    `driver ${entry.name}: no manifest at ${manifestFile} and no matching config.json entry`,
  );
}

function resolveExternalEntry(entry) {
  const checkoutDir = cloneExternalDriver(entry);
  const manifestRel = entry.manifestPath || 'manifest.json';
  const manifestFile = path.resolve(checkoutDir, manifestRel);
  if (!fs.existsSync(manifestFile)) {
    throw new Error(`driver ${entry.name}: manifest not found at ${manifestFile}`);
  }
  return {
    name: entry.name,
    source: 'external',
    transport: 'http',
    implDir: path.dirname(manifestFile),
    manifestPath: manifestFile,
    repoUrl: entry.repoUrl,
    ref: entry.ref || 'main',
  };
}

function resolveDriver(entry, rootDir, configFallback) {
  if (entry.source === 'in-tree') return resolveInTreeEntry(entry, rootDir, configFallback);
  if (entry.source === 'external') return resolveExternalEntry(entry, rootDir);
  throw new Error(`driver ${entry.name || '<unnamed>'}: unknown source "${entry.source}"`);
}

function loadRegistry({ registryPath, configPath, rootDir } = {}) {
  if (!registryPath) throw new Error('loadRegistry: registryPath is required');
  if (!rootDir) throw new Error('loadRegistry: rootDir is required');

  const registry = loadJson(registryPath);
  if (!Array.isArray(registry.drivers)) {
    throw new Error(`registry at ${registryPath}: "drivers" must be an array`);
  }
  if (!registry.reference) {
    throw new Error(`registry at ${registryPath}: "reference" is required`);
  }

  const configFallback = configPath && fs.existsSync(configPath) ? loadJson(configPath) : null;
  const drivers = registry.drivers.map((entry) => resolveDriver(entry, rootDir, configFallback));

  const byName = new Map(drivers.map((d) => [d.name, d]));
  if (!byName.has(registry.reference)) {
    throw new Error(
      `registry at ${registryPath}: reference "${registry.reference}" is not in drivers list`,
    );
  }

  return { reference: registry.reference, drivers, byName };
}

function loadConfigAsRegistry({ configPath, rootDir } = {}) {
  const config = loadJson(configPath);
  const drivers = Object.entries(config.impls || {}).map(([name, impl]) => ({
    name,
    source: 'in-tree',
    transport: 'subprocess',
    implDir: path.resolve(rootDir, impl.path),
    command: impl.command,
    buildTimeoutMs: impl.buildTimeoutMs,
  }));
  const byName = new Map(drivers.map((d) => [d.name, d]));
  return { reference: config.reference, drivers, byName };
}

function filterDrivers(registry, { only, exclude }) {
  const onlySet = only && only.length ? new Set(only) : null;
  const excludeSet = exclude && exclude.length ? new Set(exclude) : new Set();

  const kept = [];
  for (const driver of registry.drivers) {
    if (driver.name === registry.reference) {
      kept.push(driver);
      continue;
    }
    if (excludeSet.has(driver.name)) continue;
    if (onlySet && !onlySet.has(driver.name)) continue;
    kept.push(driver);
  }

  return { reference: registry.reference, drivers: kept, byName: new Map(kept.map((d) => [d.name, d])) };
}

module.exports = {
  loadRegistry,
  loadConfigAsRegistry,
  resolveDriver,
  filterDrivers,
};
