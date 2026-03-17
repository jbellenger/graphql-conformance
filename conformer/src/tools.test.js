'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { checkMise, checkTool, checkTools } = require('./tools');

describe('checkMise', () => {
  it('detects mise when installed', () => {
    const result = checkMise();
    // mise may or may not be installed in the test env
    assert.equal(typeof result.found, 'boolean');
    if (result.found) {
      assert.ok(result.version);
    }
  });
});

describe('checkTool', () => {
  it('finds node (always available)', () => {
    const result = checkTool('node');
    assert.equal(result.name, 'node');
    assert.equal(result.found, true);
    assert.ok(result.version);
  });

  it('finds git (always available)', () => {
    const result = checkTool('git');
    assert.equal(result.name, 'git');
    assert.equal(result.found, true);
    assert.ok(result.version);
  });

  it('returns found=false for nonexistent tool', () => {
    const result = checkTool('nonexistent-tool-xyz-12345');
    assert.equal(result.name, 'nonexistent-tool-xyz-12345');
    assert.equal(result.found, false);
    assert.equal(result.version, null);
  });
});

describe('checkTools', () => {
  it('checks multiple tools', () => {
    const results = checkTools(['node', 'nonexistent-tool-xyz-12345']);
    assert.equal(results.length, 2);
    assert.equal(results[0].name, 'node');
    assert.equal(results[0].found, true);
    assert.equal(results[1].name, 'nonexistent-tool-xyz-12345');
    assert.equal(results[1].found, false);
  });
});
