#!/usr/bin/env python3
"""
Static server with SPA fallback for local development.

`python3 -m http.server` returns 404 for paths that don't map to a file on
disk, which breaks refresh on client-routed URLs (e.g. /impl/hot-chocolate).
Deployed GitHub Pages works around this with public/404.html's redirect
script; locally we just serve index.html for any unknown path and let
React Router handle it from window.location.

Usage: serve-site.py <port> <dir>
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys


class SPAHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        requested = self.translate_path(self.path)
        path = Path(requested)
        # Serve index.html for any non-existent path that isn't a data asset
        # (so a genuinely-missing /data/... still 404s rather than returning
        # HTML, which would break the JSON/text fetches).
        if not path.exists() and not self.path.startswith('/data/'):
            self.path = '/index.html'
        return super().send_head()


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(f'usage: {argv[0]} <port> <dir>', file=sys.stderr)
        return 2
    port = int(argv[1])
    directory = argv[2]

    def handler(*args, **kwargs):
        return SPAHandler(*args, directory=directory, **kwargs)

    with ThreadingHTTPServer(('', port), handler) as httpd:
        print(f'Serving {directory} at http://localhost:{port}', flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
