'use strict';

const fs = require('fs');
const path = require('path');
const { FRAMEWORK_TOOLS, checkMise, checkTool } = require('./tools');

function main() {
  const baseDir = path.resolve(__dirname, '..');
  const configPath = path.join(baseDir, 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  let allOk = true;

  // Check mise
  const mise = checkMise();
  if (mise.found) {
    process.stderr.write(`mise      ${mise.version}\n\n`);
  } else {
    process.stderr.write(
      'mise      not found (install from https://mise.jdx.dev)\n\n'
    );
  }

  // Check framework tools
  process.stderr.write('Checking framework tools...\n');
  for (const name of FRAMEWORK_TOOLS) {
    const result = checkTool(name);
    if (result.found) {
      process.stderr.write(`  ✓ ${name.padEnd(8)} ${result.version}\n`);
    } else {
      process.stderr.write(`  ✗ ${name.padEnd(8)} not found\n`);
      allOk = false;
    }
  }

  // Collect all impl tools
  process.stderr.write('\nChecking implementation tools...\n');
  const allImpls = [config.reference, ...config.conformants];
  const checked = new Set();

  for (const impl of allImpls) {
    const tools = impl.tools || [];
    for (const name of tools) {
      if (FRAMEWORK_TOOLS.includes(name) || checked.has(name)) continue;
      checked.add(name);
      const result = checkTool(name);
      const impls = allImpls
        .filter((i) => (i.tools || []).includes(name))
        .map((i) => i.name)
        .join(', ');
      if (result.found) {
        process.stderr.write(
          `  ✓ ${name.padEnd(8)} ${result.version}  (${impls})\n`
        );
      } else {
        process.stderr.write(
          `  ✗ ${name.padEnd(8)} not found  (${impls})\n`
        );
        allOk = false;
      }
    }
  }

  if (!allOk) {
    process.stderr.write(
      '\nSome tools are missing. Run `mise install` in conformer/ to install.\n'
    );
    process.exit(1);
  }

  process.stderr.write('\nAll tools available.\n');
}

main();
