'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { version, versionInfo } = require('graphql');

describe('graphql-js-17 installed version', () => {
  it('reports a 17.x version (not 16.x)', () => {
    const major = parseInt(String(version).split('.')[0], 10);
    assert.equal(
      major,
      17,
      `expected graphql major version 17, got ${version}`
    );
  });

  it('versionInfo.major is 17', () => {
    assert.equal(
      versionInfo.major,
      17,
      `expected versionInfo.major 17, got ${versionInfo.major} (full: ${JSON.stringify(versionInfo)})`
    );
  });
});
