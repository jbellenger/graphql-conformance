import { describe, expect, it, afterEach } from 'vitest';
import { StaticJsonRepository } from './StaticJsonRepository';

// Regression test for the "Illegal invocation" bug: when the default fetch
// (global `fetch`) was stored as `this.fetchImpl` without binding, calling
// `this.fetchImpl(url)` in a browser context threw
// "Failed to execute 'fetch' on 'Window': Illegal invocation".
// Unit tests pass a function mock so they didn't surface the issue; this
// test verifies that the default constructor path works with the real
// global fetch by installing a throwing stub on globalThis that would only
// be reachable if `this` is bound correctly.
describe('StaticJsonRepository (default fetch binding)', () => {
  let restored: typeof fetch | undefined;

  afterEach(() => {
    if (restored) {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = restored;
      restored = undefined;
    }
  });

  it('invokes the bound global fetch without losing `this`', async () => {
    restored = globalThis.fetch;
    // A fetch that requires `this === globalThis` to succeed.
    const stub = function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError(
          "Failed to execute 'fetch' on 'Window': Illegal invocation",
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    } as unknown as typeof fetch;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = stub;

    const repo = new StaticJsonRepository('http://example.test/data/');
    const impls = await repo.listImpls();
    expect(impls).toEqual([]);
  });
});
