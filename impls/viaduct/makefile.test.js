'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const IMPL_DIR = __dirname;
const BUILD_DIR = path.join(IMPL_DIR, 'build');
const SENTINEL = path.join(BUILD_DIR, '__sentinel__');

describe('viaduct Makefile', () => {
  it('clean preserves build/ (coordinator-managed upstream checkout)', () => {
    // Setup: ensure build/ exists and drop a sentinel file inside it.
    fs.mkdirSync(BUILD_DIR, { recursive: true });
    fs.writeFileSync(SENTINEL, 'sentinel\n');
    assert.ok(fs.existsSync(SENTINEL), 'sentinel should exist before clean');

    try {
      // Act: run `make clean` in the impl directory.
      execFileSync('make', ['clean'], {
        cwd: IMPL_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Assert: build/ and the sentinel file are still present.
      assert.ok(fs.existsSync(BUILD_DIR), 'build/ directory must survive `make clean`');
      assert.ok(
        fs.existsSync(SENTINEL),
        'sentinel inside build/ must survive `make clean` (build/ is coordinator-managed)',
      );
    } finally {
      // Cleanup: remove the sentinel so the test is repeatable.
      if (fs.existsSync(SENTINEL)) {
        fs.rmSync(SENTINEL, { force: true });
      }
    }
  });
});
