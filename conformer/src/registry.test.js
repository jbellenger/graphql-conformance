'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadRegistry, filterDrivers } = require('./registry');

function mkdtemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'registry-test-'));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

test('loadRegistry resolves in-tree HTTP driver via manifest.json', () => {
  const rootDir = mkdtemp();
  writeFile(path.join(rootDir, 'impls/demo/manifest.json'), JSON.stringify({ name: 'demo' }));
  writeFile(path.join(rootDir, 'registry.json'), JSON.stringify({
    registryVersion: 1,
    reference: 'demo',
    drivers: [{ name: 'demo', source: 'in-tree', manifestPath: './impls/demo/manifest.json' }],
  }));

  const reg = loadRegistry({
    registryPath: path.join(rootDir, 'registry.json'),
    rootDir,
  });
  assert.strictEqual(reg.reference, 'demo');
  assert.strictEqual(reg.drivers.length, 1);
  assert.strictEqual(reg.drivers[0].transport, 'http');
  assert.strictEqual(reg.drivers[0].implDir, path.join(rootDir, 'impls/demo'));
  assert.strictEqual(reg.drivers[0].enabled, true);
});

test('loadRegistry preserves explicit enabled false', () => {
  const rootDir = mkdtemp();
  writeFile(path.join(rootDir, 'impls/ref/manifest.json'), '{}');
  writeFile(path.join(rootDir, 'impls/old/manifest.json'), '{}');
  writeFile(path.join(rootDir, 'registry.json'), JSON.stringify({
    registryVersion: 1,
    reference: 'ref',
    drivers: [
      { name: 'ref', source: 'in-tree', manifestPath: './impls/ref/manifest.json' },
      { name: 'old', source: 'in-tree', manifestPath: './impls/old/manifest.json', enabled: false },
    ],
  }));

  const reg = loadRegistry({
    registryPath: path.join(rootDir, 'registry.json'),
    rootDir,
  });
  assert.strictEqual(reg.byName.get('old').enabled, false);
});

test('loadRegistry throws when manifest is missing for an in-tree driver', () => {
  const rootDir = mkdtemp();
  writeFile(path.join(rootDir, 'registry.json'), JSON.stringify({
    registryVersion: 1,
    reference: 'missing-manifest',
    drivers: [{ name: 'missing-manifest', source: 'in-tree', manifestPath: './impls/missing-manifest/manifest.json' }],
  }));

  assert.throws(
    () => loadRegistry({ registryPath: path.join(rootDir, 'registry.json'), rootDir }),
    /no manifest/,
  );
});

test('loadRegistry throws on unknown source', () => {
  const rootDir = mkdtemp();
  writeFile(path.join(rootDir, 'registry.json'), JSON.stringify({
    registryVersion: 1,
    reference: 'x',
    drivers: [{ name: 'x', source: 'lunar' }],
  }));
  assert.throws(
    () => loadRegistry({ registryPath: path.join(rootDir, 'registry.json'), rootDir }),
    /unknown source/,
  );
});

test('loadRegistry throws when reference is missing from drivers list', () => {
  const rootDir = mkdtemp();
  writeFile(path.join(rootDir, 'impls/a/manifest.json'), '{}');
  writeFile(path.join(rootDir, 'registry.json'), JSON.stringify({
    registryVersion: 1,
    reference: 'missing',
    drivers: [{ name: 'a', source: 'in-tree', manifestPath: './impls/a/manifest.json' }],
  }));
  assert.throws(
    () => loadRegistry({ registryPath: path.join(rootDir, 'registry.json'), rootDir }),
    /reference "missing" is not in drivers list/,
  );
});

test('loadRegistry throws when enabled is not boolean', () => {
  const rootDir = mkdtemp();
  writeFile(path.join(rootDir, 'impls/ref/manifest.json'), '{}');
  writeFile(path.join(rootDir, 'registry.json'), JSON.stringify({
    registryVersion: 1,
    reference: 'ref',
    drivers: [{ name: 'ref', source: 'in-tree', manifestPath: './impls/ref/manifest.json', enabled: 'false' }],
  }));
  assert.throws(
    () => loadRegistry({ registryPath: path.join(rootDir, 'registry.json'), rootDir }),
    /"enabled" must be boolean/,
  );
});

test('loadRegistry throws when reference is disabled', () => {
  const rootDir = mkdtemp();
  writeFile(path.join(rootDir, 'impls/ref/manifest.json'), '{}');
  writeFile(path.join(rootDir, 'registry.json'), JSON.stringify({
    registryVersion: 1,
    reference: 'ref',
    drivers: [{ name: 'ref', source: 'in-tree', manifestPath: './impls/ref/manifest.json', enabled: false }],
  }));
  assert.throws(
    () => loadRegistry({ registryPath: path.join(rootDir, 'registry.json'), rootDir }),
    /reference "ref" is disabled/,
  );
});

test('filterDrivers keeps reference even if not in only-list', () => {
  const reg = {
    reference: 'ref',
    drivers: [
      { name: 'ref' },
      { name: 'a' },
      { name: 'b' },
      { name: 'c' },
    ],
  };
  const filtered = filterDrivers(reg, { only: ['a', 'c'] });
  assert.deepStrictEqual(filtered.drivers.map((d) => d.name), ['ref', 'a', 'c']);
});

test('filterDrivers exclude removes named conformants', () => {
  const reg = {
    reference: 'ref',
    drivers: [{ name: 'ref' }, { name: 'a' }, { name: 'b' }],
  };
  const filtered = filterDrivers(reg, { exclude: ['a'] });
  assert.deepStrictEqual(filtered.drivers.map((d) => d.name), ['ref', 'b']);
});

test('filterDrivers skips disabled conformants by default', () => {
  const reg = {
    reference: 'ref',
    drivers: [{ name: 'ref' }, { name: 'active' }, { name: 'old', enabled: false }],
  };
  const filtered = filterDrivers(reg, {});
  assert.deepStrictEqual(filtered.drivers.map((d) => d.name), ['ref', 'active']);
});

test('filterDrivers includes disabled conformants when explicitly named', () => {
  const reg = {
    reference: 'ref',
    drivers: [{ name: 'ref' }, { name: 'active' }, { name: 'old', enabled: false }],
  };
  const filtered = filterDrivers(reg, { only: ['old'] });
  assert.deepStrictEqual(filtered.drivers.map((d) => d.name), ['ref', 'old']);
});

test('loadRegistry resolves an external driver by cloning a local git repo', () => {
  const { execFileSync } = require('child_process');
  const rootDir = mkdtemp();
  const externalRepo = mkdtemp();
  const cacheDir = mkdtemp();

  // Initialize a tiny git repo that looks like an external driver.
  execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: externalRepo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: externalRepo });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: externalRepo });
  writeFile(path.join(externalRepo, 'manifest.json'), JSON.stringify({
    manifestVersion: 1,
    name: 'cloned-driver',
    image: { build: { dockerfile: './Dockerfile', context: '.' } },
    runtime: { port: 8080 },
  }));
  execFileSync('git', ['add', '.'], { cwd: externalRepo });
  execFileSync('git', ['commit', '--quiet', '-m', 'init'], { cwd: externalRepo });

  writeFile(path.join(rootDir, 'impls/in-tree-ref/manifest.json'), JSON.stringify({ name: 'in-tree-ref' }));
  writeFile(path.join(rootDir, 'registry.json'), JSON.stringify({
    registryVersion: 1,
    reference: 'in-tree-ref',
    drivers: [
      { name: 'in-tree-ref', source: 'in-tree', manifestPath: './impls/in-tree-ref/manifest.json' },
      { name: 'cloned-driver', source: 'external', repoUrl: externalRepo, ref: 'main' },
    ],
  }));

  const prevCache = process.env.EXTERNAL_DRIVER_CACHE;
  process.env.EXTERNAL_DRIVER_CACHE = cacheDir;
  try {
    const reg = loadRegistry({
      registryPath: path.join(rootDir, 'registry.json'),
      rootDir,
    });
    const external = reg.drivers.find((d) => d.name === 'cloned-driver');
    assert.ok(external);
    assert.strictEqual(external.source, 'external');
    assert.strictEqual(external.transport, 'http');
    assert.ok(fs.existsSync(external.manifestPath), 'manifest was cloned');
  } finally {
    if (prevCache === undefined) delete process.env.EXTERNAL_DRIVER_CACHE;
    else process.env.EXTERNAL_DRIVER_CACHE = prevCache;
  }
});
