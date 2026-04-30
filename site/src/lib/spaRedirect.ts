// Normalizes the URL before React Router initializes. Handles two cases:
//
// 1. SPA redirect from public/404.html: GitHub Pages serves 404.html for any
//    unknown path, which bounces the user back to the SPA entry with the real
//    path encoded in the query string as `?/real/path`. We decode that back
//    into a real pathname so BrowserRouter routes correctly.
//    Based on https://github.com/rafgraph/spa-github-pages (MIT).
//
// 2. Legacy HashRouter URL (`/base/#/runs/foo`): old deep links shared before
//    the BrowserRouter migration would otherwise land on the Dashboard,
//    because BrowserRouter ignores the hash. Migrate `#/...` in-place.
export function normalizeBootstrapUrl(win: Window, basename: string): void {
  const l = win.location;

  if (l.search[1] === '/') {
    const decoded = l.search
      .slice(1)
      .split('&')
      .map((s) => s.replace(/~and~/g, '&'))
      .join('?');
    win.history.replaceState(null, '', l.pathname.slice(0, -1) + decoded + l.hash);
    return;
  }

  if (l.hash.startsWith('#/') && l.pathname === basename) {
    const base = basename.endsWith('/') ? basename.slice(0, -1) : basename;
    win.history.replaceState(null, '', base + l.hash.slice(1));
  }
}
