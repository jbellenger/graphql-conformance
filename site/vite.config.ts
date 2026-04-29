import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// In prod, the Makefile copies `corpus/` into `site/dist/data/corpus/` so the
// failure detail page can fetch test input as a static asset. In dev, vite
// serves from `public/`, which doesn't contain the corpus — this middleware
// routes `/data/corpus/*` requests to the repo's `corpus/` directory so
// `npm run dev` works with no extra setup.
function serveCorpusInDev(): Plugin {
  return {
    name: 'serve-corpus-in-dev',
    apply: 'serve',
    configureServer(server) {
      const corpusRoot = resolve(process.cwd(), '..', 'corpus');
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        const prefix = '/data/corpus/';
        const idx = req.url.indexOf(prefix);
        if (idx === -1) return next();
        const rel = decodeURIComponent(
          req.url.slice(idx + prefix.length).split('?')[0],
        );
        const filePath = resolve(corpusRoot, rel);
        // Path traversal guard.
        if (!filePath.startsWith(corpusRoot)) return next();
        if (!existsSync(filePath) || !statSync(filePath).isFile()) {
          return next();
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveCorpusInDev()],
  base: process.env.VITE_BASE_URL ?? '/',
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    css: false,
  },
});
