'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runHarness } = require('./runner');
const { getToolEnv } = require('./tools');

const baseDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(baseDir, '..');
const configPath = path.join(baseDir, 'config.json');
const corpusDir = path.join(rootDir, 'corpus', '0');

const EXPECTED = {
  data: {
    intField: 2,
    floatField: 3.14,
    stringField: 'str',
    booleanField: true,
    idField: 'id',
    enumField: 'RED',
    nonNullInt: 2,
    listOfStrings: ['str', 'str'],
    listOfInts: [2, 2],
    objectField: { value: 'str', number: 2 },
    unionField: { alphaField: 'str' },
    interfaceField: { sharedField: 'str', bField: 3.14 },
    listOfObjects: [
      { value: 'str', number: 2 },
      { value: 'str', number: 2 },
    ],
    listOfUnions: [
      { alphaField: 'str' },
      { alphaField: 'str' },
    ],
    listOfInterfaces: [
      { sharedField: 'str', bField: 3.14 },
      { sharedField: 'str', bField: 3.14 },
    ],
    listOfEnums: ['RED', 'RED'],
    caseUnionField: { mbField: 'str' },
    caseInterfaceField: { shared: 'str', naField: 2 },
  },
};

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const allImpls = [config.reference, ...config.conformants];

const schemaPath = path.join(corpusDir, 'schema.graphqls');
const queryPath = path.join(corpusDir, '0', 'query.graphql');

const env = getToolEnv(rootDir);

describe('sanity: corpus/0 produces expected output', () => {
  for (const impl of allImpls) {
    it(impl.name, async () => {
      const implDir = path.resolve(rootDir, impl.path);
      const result = await runHarness(impl.command, implDir, [schemaPath, queryPath], env);
      assert.equal(result.error, undefined, `impl errored: ${result.error}`);
      assert.deepStrictEqual(result.result, EXPECTED);
    });
  }
});
