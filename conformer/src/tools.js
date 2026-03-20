'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FRAMEWORK_TOOLS = ['node', 'git', 'make'];
const TOOL_REQUIREMENT_CACHE = new Map();

function checkTool(name, baseDir) {
  const requiredVersion = getRequiredVersion(name, baseDir);
  // Try mise first
  try {
    const installDir = execFileSync('mise', ['where', name], {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (installDir) {
      return { name, found: true, version: getVersionFromInstall(name, installDir) };
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
    const version = getVersion(name);
    if (requiredVersion && !versionSatisfiesRequirement(version, requiredVersion)) {
      return { name, found: false, version };
    }
    return { name, found: true, version };
  } catch {
    return { name, found: false, version: null };
  }
}

// Maps mise tool names to the binary name used for checking PATH and version.
const TOOL_BINARIES = {
  maven: 'mvn',
  rust: 'cargo',
  python: 'python3',
  erlang: 'erl',
};

function toolBinary(name) {
  return TOOL_BINARIES[name] || name;
}

function getVersion(name) {
  const bin = toolBinary(name);
  return getVersionForCommand(versionCommand(name, bin));
}

function checkTools(names, baseDir) {
  return names.map((name) => checkTool(name, baseDir));
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

function miseInstall(cwd, toolNames = []) {
  try {
    execFileSync('mise', ['install', '-y', ...toolNames], {
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
  const results = checkTools(toolNames, baseDir);
  const missing = results.filter((r) => !r.found);

  if (missing.length === 0) {
    return { results, installed: [], failed: [] };
  }

  // Try mise install if mise is available
  const mise = checkMise();
  if (!mise.found) {
    return { results, installed: [], failed: missing.map((r) => r.name) };
  }

  const installResult = miseInstall(baseDir, missing.map((r) => r.name));
  if (!installResult.ok) {
    process.stderr.write(`  mise install failed: ${installResult.error}\n`);
    return { results, installed: [], failed: missing.map((r) => r.name) };
  }

  // Re-check previously missing tools
  const installed = [];
  const failed = [];
  for (const m of missing) {
    const recheck = checkTool(m.name, baseDir);
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

function getVersionFromInstall(name, installDir) {
  const bin = toolBinary(name);
  const candidates = [
    path.join(installDir, 'bin', bin),
    path.join(installDir, bin),
  ];

  for (const candidate of candidates) {
    const version = getVersionForCommand(versionCommand(name, candidate));
    if (version !== 'unknown') return version;
  }

  return getVersion(name);
}

function versionCommand(name, executable) {
  const versionCommands = {
    node: [executable, '--version'],
    git: [executable, '--version'],
    make: [executable, '--version'],
    go: [executable, 'version'],
    java: [executable, '-version'],
    mvn: [executable, '--version'],
    cargo: [executable, '--version'],
    dotnet: [executable, '--version'],
    ruby: [executable, '--version'],
    php: [executable, '--version'],
    elixir: [executable, '--version'],
    erlang: [executable, '-version'],
    python: [executable, '--version'],
    sbt: [executable, '--version'],
    lein: [executable, '--version'],
  };

  return versionCommands[name] || [executable, '--version'];
}

function getVersionForCommand(cmd) {
  try {
    const result = require('child_process').spawnSync(cmd[0], cmd.slice(1), {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const output = (result.stdout || '') + (result.stderr || '');
    const line = output.split('\n').find((l) => l.trim());
    if (line && result.status === 0) return line.trim();
  } catch {
    // ignore and fall through
  }

  return 'unknown';
}

function getRequiredVersion(name, baseDir) {
  if (!baseDir) return null;
  return loadToolRequirements(baseDir)[name] || null;
}

function loadToolRequirements(baseDir) {
  const configPath = path.join(baseDir, '.mise.toml');
  if (TOOL_REQUIREMENT_CACHE.has(configPath)) {
    return TOOL_REQUIREMENT_CACHE.get(configPath);
  }

  const requirements = {};
  try {
    const text = fs.readFileSync(configPath, 'utf8');
    let inTools = false;
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      if (line === '[tools]') {
        inTools = true;
        continue;
      }
      if (inTools && line.startsWith('[')) break;

      if (inTools) {
        const match = line.match(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/);
        if (match) {
          requirements[match[1]] = match[2];
        }
      }
    }
  } catch {
    // ignore parse failures and fall back to presence-only checks
  }

  TOOL_REQUIREMENT_CACHE.set(configPath, requirements);
  return requirements;
}

function versionSatisfiesRequirement(versionText, requiredVersion) {
  const installed = parseNumericVersion(versionText);
  const required = parseNumericVersion(requiredVersion);

  if (!installed || !required) return true;

  const width = Math.max(installed.length, required.length);
  for (let i = 0; i < width; i += 1) {
    const left = installed[i] || 0;
    const right = required[i] || 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
}

function parseNumericVersion(text) {
  if (!text) return null;
  const match = text.match(/(\d+(?:\.\d+)+|\d+)/);
  if (!match) return null;
  return match[1].split('.').map((part) => Number.parseInt(part, 10));
}

module.exports = {
  FRAMEWORK_TOOLS,
  checkMise,
  checkTool,
  checkTools,
  ensureTools,
  getToolEnv,
  parseNumericVersion,
  toolBinary,
  versionSatisfiesRequirement,
};
