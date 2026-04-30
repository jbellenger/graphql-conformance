import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// These tests pin down the static files that keep Cloudflare Web Analytics
// working on the GitHub Pages deploy. If any assertion fails, analytics or
// SPA deep links will likely break in prod even if the app itself still runs.
const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');

const indexHtml = read('../index.html');
const page404 = read('../public/404.html');
const appTsx = read('./App.tsx');

describe('Cloudflare Web Analytics beacon in index.html', () => {
  it('loads the beacon script', () => {
    expect(indexHtml).toContain(
      'https://static.cloudflareinsights.com/beacon.min.js',
    );
  });

  it('embeds a non-empty site token', () => {
    const match = indexHtml.match(/data-cf-beacon='[^']*"token"\s*:\s*"([^"]+)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/^[a-f0-9]{16,}$/);
  });

  it('CSP script-src allows static.cloudflareinsights.com', () => {
    const csp = indexHtml.match(
      /Content-Security-Policy"\s+content="([^"]+)"/,
    )?.[1];
    expect(csp).toBeDefined();
    expect(csp).toMatch(/script-src[^;]*\bstatic\.cloudflareinsights\.com\b/);
  });

  it('CSP connect-src allows the beacon telemetry endpoint', () => {
    const csp = indexHtml.match(
      /Content-Security-Policy"\s+content="([^"]+)"/,
    )?.[1];
    expect(csp).toMatch(/connect-src[^;]*\bcloudflareinsights\.com\b/);
  });
});

describe('GitHub Pages SPA fallback', () => {
  it('public/404.html encodes the pathname into a ?/ query for decoding', () => {
    expect(page404).toContain("'/?/'");
    expect(page404).toContain('l.pathname.split');
    expect(page404).toContain('~and~');
  });
});

describe('Router choice', () => {
  it('App.tsx uses BrowserRouter (not HashRouter)', () => {
    // HashRouter breaks Cloudflare Web Analytics SPA tracking because the
    // pathname never changes on hash-based navigation.
    expect(appTsx).toMatch(/\bBrowserRouter\b/);
    expect(appTsx).not.toMatch(/\bHashRouter\b/);
  });
});
