'use strict';

const fs = require('fs');
const path = require('path');
const { buildAll, BUILD_OUTPUT_TAIL_LINES, tailLines } = require('./builder');
const { FRAMEWORK_TOOLS, checkTools } = require('./tools');

async function main() {
  const baseDir = path.resolve(__dirname, '..');
  const rootDir = path.resolve(baseDir, '..');
  const configPath = path.join(rootDir, 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  // Collect all required tools from config
  const allImpls = Object.entries(config.impls).map(([name, impl]) => ({ name, ...impl }));
  const implTools = [...new Set(allImpls.flatMap((i) => i.tools || []))];
  const allTools = [...new Set([...FRAMEWORK_TOOLS, ...implTools])];

  process.stderr.write('Checking tools...\n');
  const toolResults = checkTools(allTools);
  const missing = [];
  for (const r of toolResults) {
    if (r.found) {
      process.stderr.write(`  ✓ ${r.name.padEnd(8)} ${r.version}\n`);
    } else {
      process.stderr.write(`  ✗ ${r.name.padEnd(8)} not found\n`);
      missing.push(r.name);
    }
  }
  if (missing.length > 0) {
    process.stderr.write(`  Missing: ${missing.join(', ')} — rebuild the dev image with \`make image\`.\n`);
  }
  process.stderr.write('\n');

  process.stderr.write('Building all implementations...\n');
  const results = await buildAll(config, rootDir);

  const succeeded = results.filter((r) => r.ok).length;
  const buildFailed = results.filter((r) => !r.ok).length;

  process.stderr.write(`\nBuild complete: ${succeeded} succeeded, ${buildFailed} failed\n`);
  for (const r of results) {
    const status = r.ok ? 'ok' : `FAILED: ${r.error}`;
    process.stderr.write(`  ${r.name}: ${status}\n`);
  }

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    for (const r of failures) {
      process.stderr.write(`\n--- ${r.name}: last ${BUILD_OUTPUT_TAIL_LINES} lines of build output ---\n`);
      const stdoutTail = tailLines(r.stdout, BUILD_OUTPUT_TAIL_LINES);
      const stderrTail = tailLines(r.stderr, BUILD_OUTPUT_TAIL_LINES);
      if (stdoutTail) process.stderr.write(`[stdout]\n${stdoutTail}\n`);
      if (stderrTail) process.stderr.write(`[stderr]\n${stderrTail}\n`);
      if (!stdoutTail && !stderrTail) process.stderr.write('(no output captured)\n');
    }
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
