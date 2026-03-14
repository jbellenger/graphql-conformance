'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runHarness } = require('./runner');

describe('runHarness', () => {
  it('returns parsed JSON on success', async () => {
    const result = await runHarness(
      ['node', '-e', 'console.log(JSON.stringify({data:{x:1}}))'], '/tmp', []
    );
    assert.deepStrictEqual(result, { result: { data: { x: 1 } } });
  });

  it('returns error on non-zero exit', async () => {
    const result = await runHarness(['node', '-e', 'process.exit(1)'], '/tmp', []);
    assert.ok(result.error);
    assert.match(result.error, /exit.*code/i);
  });

  it('returns error on invalid JSON output', async () => {
    const result = await runHarness(
      ['node', '-e', 'console.log("not json")'], '/tmp', []
    );
    assert.deepStrictEqual(result, { error: 'invalid JSON output' });
  });

  it('returns error when command does not exist', async () => {
    const result = await runHarness(['/nonexistent/binary'], '/tmp', []);
    assert.ok(result.error);
  });

  it('appends args to command', async () => {
    const result = await runHarness(
      ['node', '-e', 'console.log(JSON.stringify({args:process.argv.slice(1)}))'],
      '/tmp',
      ['a', 'b']
    );
    assert.deepStrictEqual(result, { result: { args: ['a', 'b'] } });
  });
});
