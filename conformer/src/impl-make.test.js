'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { getRootDir, loadConfig } = require('./impl-cli');
const { resolveImplByDir } = require('./impl-make');

describe('resolveImplByDir', () => {
  it('matches an impl directory to its config entry', () => {
    const rootDir = getRootDir();
    const config = loadConfig(rootDir);
    const cwd = path.join(rootDir, 'impls');

    const impl = resolveImplByDir(config, rootDir, cwd, 'graphql-ruby');
    assert.equal(impl.name, 'graphql-ruby');
    assert.deepEqual(impl.tools, ['ruby']);
  });

  it('throws for an unknown impl directory', () => {
    const rootDir = getRootDir();
    const config = loadConfig(rootDir);
    const cwd = path.join(rootDir, 'impls');

    assert.throws(
      () => resolveImplByDir(config, rootDir, cwd, 'nope'),
      /Unknown impl directory/,
    );
  });
});
