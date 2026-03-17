'use strict';

const { execFileSync } = require('child_process');

const FRAMEWORK_TOOLS = ['node', 'git', 'make'];

function checkTool(name) {
  // Try mise first
  try {
    const version = execFileSync('mise', ['where', name], {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (version) {
      return { name, found: true, version: getVersion(name) };
    }
  } catch {
    // mise doesn't have it — fall back to which
  }

  // Fall back to checking PATH directly using the binary name
  const bin = toolBinary(name);
  try {
    execFileSync('which', [bin], {
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { name, found: true, version: getVersion(name) };
  } catch {
    return { name, found: false, version: null };
  }
}

// Maps mise tool names to the binary name used for checking PATH and version.
const TOOL_BINARIES = {
  maven: 'mvn',
  rust: 'cargo',
};

function toolBinary(name) {
  return TOOL_BINARIES[name] || name;
}

function getVersion(name) {
  const bin = toolBinary(name);
  const versionCommands = {
    node: [bin, '--version'],
    git: [bin, '--version'],
    make: [bin, '--version'],
    go: [bin, 'version'],
    java: [bin, '-version'],
    mvn: [bin, '--version'],
    cargo: [bin, '--version'],
    dotnet: [bin, '--version'],
    ruby: [bin, '--version'],
    php: [bin, '--version'],
    elixir: [bin, '--version'],
    python: ['python3', '--version'],
    sbt: [bin, '--version'],
    lein: [bin, '--version'],
  };

  const cmd = versionCommands[name] || versionCommands[bin] || [bin, '--version'];

  // Try running directly first, then via `mise exec` for mise-managed tools
  for (const args of [cmd, ['mise', 'exec', '--', ...cmd]]) {
    try {
      const result = require('child_process').spawnSync(args[0], args.slice(1), {
        encoding: 'utf8',
        timeout: 10_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Combine stdout and stderr — some tools (like java) write to stderr
      const output = (result.stdout || '') + (result.stderr || '');
      const line = output.split('\n').find((l) => l.trim());
      if (line && result.status === 0) return line.trim();
    } catch {
      // try next approach
    }
  }
  return 'unknown';
}

function checkTools(names) {
  return names.map((name) => checkTool(name));
}

function checkMise() {
  try {
    const version = execFileSync('mise', ['--version'], {
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return { found: true, version };
  } catch {
    return { found: false, version: null };
  }
}

function miseInstall(cwd) {
  try {
    execFileSync('mise', ['install', '-y'], {
      cwd,
      timeout: 5 * 60 * 1000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true };
  } catch (err) {
    const message = err.stderr ? err.stderr.toString().trim() : err.message;
    return { ok: false, error: message };
  }
}

function ensureTools(toolNames, baseDir) {
  const results = checkTools(toolNames);
  const missing = results.filter((r) => !r.found);

  if (missing.length === 0) {
    return { results, installed: [], failed: [] };
  }

  // Try mise install if mise is available
  const mise = checkMise();
  if (!mise.found) {
    return { results, installed: [], failed: missing.map((r) => r.name) };
  }

  const installResult = miseInstall(baseDir);
  if (!installResult.ok) {
    process.stderr.write(`  mise install failed: ${installResult.error}\n`);
    return { results, installed: [], failed: missing.map((r) => r.name) };
  }

  // Re-check previously missing tools
  const installed = [];
  const failed = [];
  for (const m of missing) {
    const recheck = checkTool(m.name);
    if (recheck.found) {
      installed.push(m.name);
    } else {
      failed.push(m.name);
    }
  }

  // Rebuild full results
  const finalResults = toolNames.map((name) => {
    if (installed.includes(name)) return checkTool(name);
    return results.find((r) => r.name === name);
  });

  return { results: finalResults, installed, failed };
}

function getToolEnv(baseDir) {
  try {
    const output = execFileSync('mise', ['env', '--shell', 'bash'], {
      cwd: baseDir,
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const env = { ...process.env };
    for (const line of output.split('\n')) {
      const match = line.match(/^export\s+(\w+)=["']?(.+?)["']?$/);
      if (match) {
        env[match[1]] = match[2];
      }
    }
    return env;
  } catch {
    return process.env;
  }
}

module.exports = {
  FRAMEWORK_TOOLS,
  checkMise,
  checkTool,
  checkTools,
  ensureTools,
  getToolEnv,
};
