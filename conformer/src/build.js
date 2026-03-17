'use strict';

const fs = require('fs');
const path = require('path');
const { buildAll } = require('./builder');
const { FRAMEWORK_TOOLS, ensureTools } = require('./tools');

async function main() {
  const baseDir = path.resolve(__dirname, '..');
  const configPath = path.join(baseDir, 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  // Collect all required tools from config
  const allImpls = [config.reference, ...config.conformants];
  const implTools = [...new Set(allImpls.flatMap((i) => i.tools || []))];
  const allTools = [...new Set([...FRAMEWORK_TOOLS, ...implTools])];

  process.stderr.write('Checking tools...\n');
  const { results: toolResults, installed, failed } = ensureTools(allTools, baseDir);
  for (const r of toolResults) {
    if (r.found) {
      process.stderr.write(`  ✓ ${r.name.padEnd(8)} ${r.version}\n`);
    } else {
      process.stderr.write(`  ✗ ${r.name.padEnd(8)} not found\n`);
    }
  }
  if (installed.length > 0) {
    process.stderr.write(`  Installed via mise: ${installed.join(', ')}\n`);
  }
  if (failed.length > 0) {
    process.stderr.write(`  Missing: ${failed.join(', ')}\n`);
  }
  process.stderr.write('\n');

  process.stderr.write('Building all implementations...\n');
  const results = await buildAll(config, baseDir);

  const succeeded = results.filter((r) => r.ok).length;
  const buildFailed = results.filter((r) => !r.ok).length;

  process.stderr.write(`\nBuild complete: ${succeeded} succeeded, ${buildFailed} failed\n`);
  for (const r of results) {
    const status = r.ok ? 'ok' : `FAILED: ${r.error}`;
    process.stderr.write(`  ${r.name}: ${status}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
