import { describe, it, expect } from 'vitest';
import { normalizeBootstrapUrl } from './spaRedirect';

function fakeWindow(pathname: string, search: string, hash: string) {
  const replaced: Array<[unknown, string, string]> = [];
  const win = {
    location: { pathname, search, hash },
    history: {
      replaceState(state: unknown, unused: string, url: string) {
        replaced.push([state, unused, url]);
      },
    },
  } as unknown as Window;
  return { win, replaced };
}

const BASE = '/graphql-conformance/';

describe('normalizeBootstrapUrl — 404.html redirect decoding', () => {
  it('restores the original URL when 404.html redirected with ?/path', () => {
    const { win, replaced } = fakeWindow(
      BASE,
      '?/impl/graphql-go/failures/abc',
      '',
    );
    normalizeBootstrapUrl(win, BASE);
    expect(replaced).toHaveLength(1);
    expect(replaced[0][2]).toBe(
      '/graphql-conformance/impl/graphql-go/failures/abc',
    );
  });

  it('decodes ~and~ back to & in the restored path', () => {
    const { win, replaced } = fakeWindow(
      BASE,
      '?/runs/2026-04-29~and~foo/impl/x',
      '',
    );
    normalizeBootstrapUrl(win, BASE);
    expect(replaced[0][2]).toBe('/graphql-conformance/runs/2026-04-29&foo/impl/x');
  });

  it('preserves a trailing hash fragment when restoring', () => {
    const { win, replaced } = fakeWindow(BASE, '?/impl/foo', '#section');
    normalizeBootstrapUrl(win, BASE);
    expect(replaced[0][2]).toBe('/graphql-conformance/impl/foo#section');
  });

  it('is a no-op for normal navigations (no ?/ prefix, no hash)', () => {
    const { win, replaced } = fakeWindow('/graphql-conformance/impl/foo', '', '');
    normalizeBootstrapUrl(win, BASE);
    expect(replaced).toHaveLength(0);
  });

  it('is a no-op when query string does not start with /', () => {
    const { win, replaced } = fakeWindow(BASE, '?tab=failures', '');
    normalizeBootstrapUrl(win, BASE);
    expect(replaced).toHaveLength(0);
  });
});

describe('normalizeBootstrapUrl — legacy HashRouter migration', () => {
  it('migrates legacy #/path URLs to pathname form', () => {
    const { win, replaced } = fakeWindow(
      BASE,
      '',
      '#/runs/79d8d08e-da02-4013-9dc2-8be1e9804b5f/impl/graphql-js-17',
    );
    normalizeBootstrapUrl(win, BASE);
    expect(replaced).toHaveLength(1);
    expect(replaced[0][2]).toBe(
      '/graphql-conformance/runs/79d8d08e-da02-4013-9dc2-8be1e9804b5f/impl/graphql-js-17',
    );
  });

  it('migrates a simple hash-based root path', () => {
    const { win, replaced } = fakeWindow(BASE, '', '#/');
    normalizeBootstrapUrl(win, BASE);
    expect(replaced[0][2]).toBe('/graphql-conformance/');
  });

  it('ignores non-route hash fragments', () => {
    const { win, replaced } = fakeWindow(BASE, '', '#section-anchor');
    normalizeBootstrapUrl(win, BASE);
    expect(replaced).toHaveLength(0);
  });

  it('does not migrate when pathname is already a real route', () => {
    const { win, replaced } = fakeWindow(
      '/graphql-conformance/impl/foo',
      '',
      '#/should-be-ignored',
    );
    normalizeBootstrapUrl(win, BASE);
    expect(replaced).toHaveLength(0);
  });
});
