import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';

// Local TLS on a xend.global origin (real passkey testing needs a Privy-trusted
// domain: Turnstile, WebAuthn rp.id, and Privy's frame-ancestors/passkey-origin
// checks all require it). Serve on whichever mkcert cert is present, preferring
// www.xend.global:443 (already in Privy's allowlist) over pay.xend.global:5173.
// Cert: `mkcert www.xend.global` -> apps/checkout/certs/. Port 443 needs sudo.
const CANDIDATES = [
  { host: 'www.xend.global', port: 443 },
  { host: 'pay.xend.global', port: 5173 },
];
const active = CANDIDATES.find(
  (c) =>
    fs.existsSync(`certs/${c.host}.pem`) &&
    fs.existsSync(`certs/${c.host}-key.pem`),
);

// Local-only harnesses under public/ (gitignored) that must never reach a
// deploy: the merchant demo wants a test API key, and the IIFE is a hand-built
// SDK bundle. In dev the demo is served with the key filled in from
// VITE_DEMO_TEST_KEY; at build time the harness files are dropped from the
// output and the build fails if any emitted file still carries a key.
const LOCAL_HARNESS_FILES = [
  'merchant-demo.html',
  'pay-modal-prototype.html',
  'xend-checkout.iife.js',
];
const DEMO_KEY_PLACEHOLDER = '__VITE_DEMO_TEST_KEY__';
const API_KEY_PATTERN = /xnd_(?:test|live)_[A-Za-z0-9_-]{8,}/;

function localHarness(demoTestKey: string): Plugin {
  let outDir = 'dist';
  return {
    name: 'xend-local-harness',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/merchant-demo.html') return next();
        const file = path.resolve('public/merchant-demo.html');
        if (!fs.existsSync(file)) return next();
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(
          fs
            .readFileSync(file, 'utf8')
            .replaceAll(DEMO_KEY_PLACEHOLDER, demoTestKey),
        );
      });
    },
    closeBundle() {
      for (const name of LOCAL_HARNESS_FILES) {
        fs.rmSync(path.join(outDir, name), { force: true });
      }
      const leaked = walk(outDir).filter((file) =>
        API_KEY_PATTERN.test(fs.readFileSync(file, 'utf8')),
      );
      if (leaked.length > 0) {
        throw new Error(
          `refusing to emit a build carrying an API key: ${leaked.join(', ')}`,
        );
      }
    },
  };
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    localHarness(loadEnv(mode, process.cwd(), '').VITE_DEMO_TEST_KEY ?? ''),
  ],
  // Privy's dependency graph pulls a second React copy; force a single instance
  // so hooks resolve to one React (otherwise: "Invalid hook call" on the ceremony).
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: active
    ? {
        host: true,
        port: active.port,
        allowedHosts: [active.host],
        https: {
          cert: fs.readFileSync(`certs/${active.host}.pem`),
          key: fs.readFileSync(`certs/${active.host}-key.pem`),
        },
        // The HTTPS checkout proxies API calls to the plain-HTTP backend so the
        // browser never sees mixed content (Vite -> backend is server-side).
        proxy: {
          '/checkout': 'http://localhost:8008',
          '/v1': 'http://localhost:8008',
        },
      }
    : undefined,
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // A distinct name for the entry, so the size gate can measure what the
        // popup actually parses before first paint. A plain `index-*` glob also
        // catches the lazily loaded vendor chunks the moment one is named
        // `index`, which turned a passing 61 kB budget into a failing 261 kB.
        entryFileNames: 'assets/popup-[hash].js',
      },
    },
  },
}));
