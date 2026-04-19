'use strict';

const { execFileSync, spawnSync } = require('child_process');

const FRAMEWORK_TOOLS = ['node', 'git', 'make'];

// Maps tool names to the binary name used for PATH and version lookup.
const TOOL_BINARIES = {
  maven: 'mvn',
  rust: 'cargo',
  python: 'python3',
  erlang: 'erl',
};

function toolBinary(name) {
  return TOOL_BINARIES[name] || name;
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

function getVersion(name) {
  const bin = toolBinary(name);
  try {
    const cmd = versionCommand(name, bin);
    const result = spawnSync(cmd[0], cmd.slice(1), {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const output = (result.stdout || '') + (result.stderr || '');
    const line = output.split('\n').find((l) => l.trim());
    if (line && result.status === 0) return line.trim();
  } catch {
    // fall through
  }
  return 'unknown';
}

function checkTool(name) {
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

function checkTools(names) {
  return names.map((name) => checkTool(name));
}

module.exports = {
  FRAMEWORK_TOOLS,
  checkTool,
  checkTools,
  toolBinary,
};
