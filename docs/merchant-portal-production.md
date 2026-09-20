# Merchant portal production serving

This records how the Merchant portal (`apps/merchant`) and the backend API are
served together, and how to check a deployment. The Vite dev proxy is not
deployment proof, so the checks below run against a real deployment.

## Routing: same-origin or configured API base

The portal calls the API at `/merchant-portal/*` and `/checkout/*`. Two supported
topologies:

1. **Same origin (preferred).** The portal's static build and the API sit behind
   one origin. A reverse proxy forwards `/merchant-portal/*` and `/checkout/*` to
   the backend and serves the SPA for everything else. `VITE_API_BASE` stays
   empty, so the browser makes same-origin requests and no CORS entry is needed.

2. **Split origin.** The portal is a static deploy on its own origin and calls
   the API cross-origin. Set `VITE_API_BASE` to the API origin at build time and
   add the portal origin to the backend's `CORS_ALLOWED_ORIGINS`. The portal
   authenticates with a bearer identity token, not cookies, so it does not depend
   on cross-site cookies.

## SPA history fallback

The portal uses real routes (`/payments`, `/payments/:id`, `/developers`,
`/webhooks`, `/account`, `/audit`). The host must serve `index.html` for any path
that is not a static asset, or a refresh or a deep link on those paths returns a 404. `apps/merchant/vercel.json` configures this for Vercel; a non-Vercel host
needs the equivalent rewrite (for example nginx `try_files $uri /index.html`).

## Security headers

The backend sets baseline security headers on every API response
(`apps/backend/src/common/security-headers.middleware.ts`):
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, and
`Strict-Transport-Security` when `NODE_ENV=production`. It deliberately sets no
Content-Security-Policy, because the Checkout surface owns its own per-merchant
`frame-ancestors` policy and a blanket CSP here would fight it.

## Environment separation

- `NODE_ENV` is required at boot and gates development-only shortcuts; production
  must set `NODE_ENV=production`.
- `WEBHOOK_ALLOW_PRIVATE_URLS` is read only in development; production keeps the
  SSRF guard on regardless.
- `CORS_ALLOWED_ORIGINS` is required and lists only the browser origins that may
  call the API.
- Test and live are separated by API key mode and webhook endpoint mode, so a
  sandbox integration never sees or retires a live delivery target.

## Smoke test

After a deploy, run:

```bash
API_URL=https://<api-origin> \
MERCHANT_URL=https://<portal-origin> \
node scripts/smoke-merchant-production.mjs
```

It verifies the API health check, the baseline security and no-store headers,
that an unauthenticated `merchant-portal/me` is rejected with 401, and that deep
links into the SPA return the app shell rather than a 404. It exits non-zero on
the first failure.

## Deferred

Mainnet execution and above-limit physical-device acceptance remain separate,
unfinished gates and are out of scope for this document.
