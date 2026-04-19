'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const { getRootDir, loadConfig } = require('./impl-cli');
const { checkTools } = require('./tools');

function resolveImplByDir(config, rootDir, cwd, dirArg) {
  const requestedDir = path.resolve(cwd, dirArg);

  for (const [name, impl] of Object.entries(config.impls)) {
    if (path.resolve(rootDir, impl.path) === requestedDir) {
      return { name, ...impl };
    }
  }

  const err = new Error(`Unknown impl directory: ${dirArg}`);
  err.available = Object.entries(config.impls).map(([name, impl]) => ({
    name,
    path: path.resolve(rootDir, impl.path),
  }));
  throw err;
}

function runImplMakeTarget(dirArg, target, cwd = process.cwd()) {
  const rootDir = getRootDir();
  const config = loadConfig(rootDir);
  const impl = resolveImplByDir(config, rootDir, cwd, dirArg);
  const tools = impl.tools || [];

  const missing = checkTools(tools).filter((r) => !r.found).map((r) => r.name);
  if (missing.length > 0) {
    process.stderr.write(
      `Missing tools for ${impl.name}: ${missing.join(', ')} — rebuild the dev image with \`make image\`.\n`
    );
    return 1;
  }

  const result = spawnSync('make', ['-C', path.resolve(rootDir, impl.path), target], {
    cwd,
    stdio: 'inherit',
  });

  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    return 1;
  }

  return result.status ?? 0;
}

if (require.main === module) {
  const [dirArg, target] = process.argv.slice(2);

  if (!dirArg || !target) {
    process.stderr.write('Usage: node conformer/src/impl-make.js <impl-dir> <target>\n');
    process.exit(1);
  }

  process.exit(runImplMakeTarget(dirArg, target));
}

module.exports = {
  resolveImplByDir,
  runImplMakeTarget,
};
