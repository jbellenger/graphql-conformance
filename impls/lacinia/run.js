'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { normalizeQuery } = require('./normalize-query');

function main() {
  const [schemaPath, queryPath, variablesPath] = process.argv.slice(2);
  if (!schemaPath || !queryPath) {
    process.stderr.write('Usage: node run.js <schema> <query> [<variables>]\n');
    process.exit(1);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lacinia-conformer-'));
  try {
    const schemaText = fs.readFileSync(schemaPath, 'utf8');
    const queryText = fs.readFileSync(queryPath, 'utf8');
    const normalizedPath = path.join(tmpDir, 'query.graphql');

    fs.writeFileSync(normalizedPath, normalizeQuery(schemaText, queryText));

    const args = ['-M', '-m', 'conformer-lacinia', schemaPath, normalizedPath];
    if (variablesPath) {
      args.push(variablesPath);
    }

    const result = spawnSync('clojure', args, {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }

    if (result.error) {
      process.stderr.write(`${result.error.message}\n`);
      process.exit(1);
    }

    process.exit(result.status ?? 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
