'use strict';

const { spawn } = require('child_process');

const TIMEOUT_MS = 30_000;

function runHarness(command, cwd, args, env) {
  return new Promise((resolve) => {
    let resolved = false;
    const [cmd, ...cmdArgs] = command;
    const opts = { cwd };
    if (env) opts.env = env;
    const child = spawn(cmd, [...cmdArgs, ...args], opts);

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill('SIGKILL');
        resolve({ error: 'timeout', stderr });
      }
    }, TIMEOUT_MS);

    child.on('close', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        if (code !== 0) {
          resolve({ error: `process exited with code ${code}`, stderr });
        } else {
          try {
            resolve({ result: JSON.parse(stdout) });
          } catch {
            resolve({ error: 'invalid JSON output', stderr });
          }
        }
      }
    });

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({ error: err.message, stderr });
      }
    });
  });
}

module.exports = { runHarness };
