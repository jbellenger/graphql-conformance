'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');

const IMPL_DIR = __dirname;
const IMPL_NAME = require('path').basename(IMPL_DIR);

describe(`${IMPL_NAME} Makefile`, () => {
  it('clean does not remove coordinator-managed build/', () => {
    // build/ is a coordinator-managed upstream checkout. Re-cloning on every
    // build is costly, so `make clean` must preserve it. We verify this
    // statically via `make -n clean` (dry-run) to avoid side effects that
    // would wipe the artifacts other tests depend on.
    const output = execFileSync('make', ['-n', 'clean'], {
      cwd: IMPL_DIR,
      encoding: 'utf8',
    });
    assert.doesNotMatch(
      output,
      /\brm\b[^\n]*\bbuild\b/,
      `make clean must not 'rm build' — clean commands were:\n${output}`,
    );
  });
});
