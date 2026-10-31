# WebAuthn Related Origins (`/.well-known/webauthn`)

Status: reference, future-proofing only (NOT a v1 runtime dependency)
Author: Pay with Prydd planning, 2026-07-11
Scope: documents the Related Origins file that `prydd.co` may serve so passkey ceremonies can run from origins outside the primary relying-party host. This is an ops artifact. Nothing in this repo serves `prydd.co`, so there is nothing to deploy from here.

## Summary

WebAuthn's Related Origin Requests lets a relying party accept ceremonies from a small set of related origins by publishing a JSON file at `https://<rp-host>/.well-known/webauthn`. For Prydd that file would live at `https://prydd.co/.well-known/webauthn`.

**This is future-proofing only. It is NOT required for v1 and must not appear in the Checkout hot path.** The Checkout surface at `pay.prydd.co` sits inside the `prydd.co` registrable domain, so plain subdomain-scoped WebAuthn already covers it: a passkey enrolled with rp.id `prydd.co` is usable from any `*.prydd.co` origin without any Related Origins declaration. See the same reasoning applied to Android Digital Asset Links at `apps/mobile/hooks/usePasskey.ts:7-10`, where `RELYING_PARTY = "https://prydd.co"` and Privy derives the WebAuthn rp.id from that registrable domain.

That covers the browser's check only. Privy's web SDK cannot name a relying party and uses the rp.id Privy returns, so whether a page on `pay.prydd.co` receives `prydd.co` has to be verified on the live host. See `privy-config-verification.md`.

## The file to serve

If and when the file is served, its exact body is:

```json
{ "origins": ["https://pay.prydd.co"] }
```

`origins` lists full origins (scheme + host, no path). Add an entry only when a real checkout origin needs it; `pay.prydd.co` is listed here for completeness even though it does not need the file today (it is already covered by subdomain scoping).

## Serving constraints

These mirror the `assetlinks.json` constraints already documented at `apps/mobile/hooks/usePasskey.ts:7-10`:

- Served directly at the apex host `prydd.co` with an HTTP `200`. No apex-to-www redirect: the WebAuthn client, like Digital Asset Links, will not follow a `prydd.co` to `www.prydd.co` redirect.
- `Content-Type: application/json`.
- Publicly reachable with no authentication.

## When this becomes load-bearing

The Related Origins file is only required once a checkout origin lives **outside** the `prydd.co` registrable domain, for example a white-label checkout served from a merchant-owned domain or a sibling domain. At that point the passkey ceremony cannot rely on subdomain scoping, and that origin must be added to the `origins` array and the file served under the constraints above before the ceremony will work from it.

Until then, adding a `*.prydd.co` origin (like `pay.prydd.co`) requires no change here, and Checkout must never fetch or depend on this file at runtime.

## Ownership

Serving `prydd.co/.well-known/webauthn` is an operations action on whatever infrastructure hosts the `prydd.co` apex (DNS, web server, or CDN). No application in this repository serves that domain, so this document exists to record the contract and the trigger condition, not to ship code.
