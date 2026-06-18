'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const GRAPHQL_PACKAGE_NAME = 'graphql';
const PACKAGE_JSON_PATH = path.resolve(__dirname, '..', 'impls', 'graphql-js-17', 'package.json');
const STABLE_GRAPHQL_17_RE = /^17\.(\d+)\.(\d+)$/;

function isStableGraphql17Version(version) {
  return typeof version === 'string' && STABLE_GRAPHQL_17_RE.test(version);
}

function parseStableGraphql17Version(version) {
  const match = typeof version === 'string' ? STABLE_GRAPHQL_17_RE.exec(version) : null;
  if (!match) return null;
  return {
    version,
    major: 17,
    minor: Number(match[1]),
    patch: Number(match[2]),
  };
}

function compareStableGraphql17Versions(left, right) {
  const leftParsed = parseStableGraphql17Version(left);
  const rightParsed = parseStableGraphql17Version(right);
  if (!leftParsed || !rightParsed) {
    throw new Error(`cannot compare non-stable graphql-js 17 versions: ${left}, ${right}`);
  }
  return leftParsed.minor - rightParsed.minor || leftParsed.patch - rightParsed.patch;
}

function latestStableGraphql17Version(versions) {
  const stableVersions = versions
    .filter(isStableGraphql17Version)
    .sort(compareStableGraphql17Versions);
  if (stableVersions.length === 0) {
    throw new Error('npm metadata did not contain any stable graphql 17.x releases');
  }
  return stableVersions[stableVersions.length - 1];
}

function readDriverPackage() {
  return JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
}

function currentDriverVersion(driverPackage = readDriverPackage()) {
  const version = driverPackage.dependencies && driverPackage.dependencies[GRAPHQL_PACKAGE_NAME];
  if (typeof version !== 'string') {
    throw new Error(`missing dependencies.${GRAPHQL_PACKAGE_NAME} in ${PACKAGE_JSON_PATH}`);
  }
  return version;
}

function assertStableGraphql17Version(version) {
  if (!isStableGraphql17Version(version)) {
    throw new Error(
      `graphql-js-17 must use a stable 17.x.y graphql release, got ${JSON.stringify(version)}`,
    );
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Accept: 'application/json' } }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`GET ${url} failed with HTTP ${res.statusCode}`));
        return;
      }

      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(chunks.join('')));
        } catch (err) {
          reject(new Error(`GET ${url} returned invalid JSON: ${err.message}`));
        }
      });
    }).on('error', reject);
  });
}

async function fetchNpmPackageMetadata(packageName) {
  const registry = (
    process.env.npm_config_registry ||
    process.env.NPM_CONFIG_REGISTRY ||
    'https://registry.npmjs.org'
  ).replace(/\/+$/, '');
  const escapedPackageName = packageName.replace('/', '%2f');
  return fetchJson(`${registry}/${escapedPackageName}`);
}

async function fetchLatestStableGraphql17Version() {
  const metadata = await fetchNpmPackageMetadata(GRAPHQL_PACKAGE_NAME);
  return latestStableGraphql17Version(Object.keys(metadata.versions || {}));
}

function writeDriverVersion(version) {
  assertStableGraphql17Version(version);
  const driverPackage = readDriverPackage();
  driverPackage.dependencies[GRAPHQL_PACKAGE_NAME] = version;
  fs.writeFileSync(PACKAGE_JSON_PATH, `${JSON.stringify(driverPackage, null, 2)}\n`);
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || '--write';
  const current = currentDriverVersion();

  if (command === '--check-local') {
    assertStableGraphql17Version(current);
    console.log(`graphql-js-17 uses stable graphql ${current}`);
    return;
  }

  if (command !== '--write' && command !== '--print-latest') {
    throw new Error(`unknown command ${command}`);
  }

  const latest = await fetchLatestStableGraphql17Version();

  if (command === '--print-latest') {
    console.log(latest);
    return;
  }

  if (current === latest) {
    console.log(`graphql-js-17 already uses latest stable graphql ${latest}`);
    return;
  }

  writeDriverVersion(latest);
  console.log(`updated graphql-js-17 from ${current} to latest stable graphql ${latest}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  assertStableGraphql17Version,
  compareStableGraphql17Versions,
  currentDriverVersion,
  isStableGraphql17Version,
  latestStableGraphql17Version,
  parseStableGraphql17Version,
};
