'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertStableGraphql17Version,
  compareStableGraphql17Versions,
  currentDriverVersion,
  isStableGraphql17Version,
  latestStableGraphql17Version,
  parseStableGraphql17Version,
} = require('./graphql-js-17-version');

test('accepts only stable graphql-js 17 releases', () => {
  assert.equal(isStableGraphql17Version('17.0.0'), true);
  assert.equal(isStableGraphql17Version('17.12.34'), true);

  assert.equal(isStableGraphql17Version('17.0.0-alpha.14'), false);
  assert.equal(isStableGraphql17Version('17.0.0-beta.2'), false);
  assert.equal(isStableGraphql17Version('17.0.0-rc.0'), false);
  assert.equal(isStableGraphql17Version('17.1.0-canary.pr.1234.deadbeef'), false);
  assert.equal(isStableGraphql17Version('16.14.2'), false);
  assert.equal(isStableGraphql17Version('18.0.0'), false);
});

test('parses and compares stable graphql-js 17 versions numerically', () => {
  assert.deepEqual(parseStableGraphql17Version('17.12.34'), {
    version: '17.12.34',
    major: 17,
    minor: 12,
    patch: 34,
  });
  assert.equal(compareStableGraphql17Versions('17.9.10', '17.10.0') < 0, true);
  assert.equal(compareStableGraphql17Versions('17.10.1', '17.10.0') > 0, true);
});

test('finds the latest stable 17 release and ignores prerelease channels', () => {
  assert.equal(
    latestStableGraphql17Version([
      '17.0.0-rc.0',
      '17.0.0',
      '17.0.1-beta.0',
      '17.0.1',
      '17.1.0-alpha.0',
      '16.14.2',
      '18.0.0',
    ]),
    '17.0.1',
  );
});

test('rejects package pins outside the stable 17 line', () => {
  assert.throws(() => assertStableGraphql17Version('17.0.0-rc.0'), /stable 17\.x\.y/);
  assert.doesNotThrow(() => assertStableGraphql17Version(currentDriverVersion()));
});
