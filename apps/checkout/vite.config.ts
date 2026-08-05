import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';

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

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
  },
});
