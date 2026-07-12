# WebAuthn Related Origins (`/.well-known/webauthn`)

Status: reference, future-proofing only (NOT a v1 runtime dependency)
Author: Pay with Xend planning, 2026-07-11
Scope: documents the Related Origins file that `xend.global` may serve so passkey ceremonies can run from origins outside the primary relying-party host. This is an ops artifact. Nothing in this repo serves `xend.global`, so there is nothing to deploy from here.

## Summary

WebAuthn's Related Origin Requests lets a relying party accept ceremonies from a small set of related origins by publishing a JSON file at `https://<rp-host>/.well-known/webauthn`. For Xend that file would live at `https://xend.global/.well-known/webauthn`.

**This is future-proofing only. It is NOT required for v1 and must not appear in the Checkout hot path.** The Checkout surface at `pay.xend.global` sits inside the `xend.global` registrable domain, so plain subdomain-scoped WebAuthn already covers it: a passkey enrolled with rp.id `xend.global` is usable from any `*.xend.global` origin without any Related Origins declaration. See the same reasoning applied to Android Digital Asset Links at `apps/mobile/hooks/usePasskey.ts:7-10`, where `RELYING_PARTY = "https://xend.global"` and Privy derives the WebAuthn rp.id from that registrable domain.

## The file to serve

If and when the file is served, its exact body is:

```json
{ "origins": ["https://pay.xend.global"] }
```

`origins` lists full origins (scheme + host, no path). Add an entry only when a real checkout origin needs it; `pay.xend.global` is listed here for completeness even though it does not need the file today (it is already covered by subdomain scoping).

## Serving constraints

These mirror the `assetlinks.json` constraints already documented at `apps/mobile/hooks/usePasskey.ts:7-10`:

- Served directly at the apex host `xend.global` with an HTTP `200`. No apex-to-www redirect: the WebAuthn client, like Digital Asset Links, will not follow an `xend.global` to `www.xend.global` redirect.
- `Content-Type: application/json`.
- Publicly reachable with no authentication.

## When this becomes load-bearing

The Related Origins file is only required once a checkout origin lives **outside** the `xend.global` registrable domain, for example a white-label checkout served from a merchant-owned domain or a `pay.xend.africa` style sibling domain. At that point the passkey ceremony cannot rely on subdomain scoping, and that origin must be added to the `origins` array and the file served under the constraints above before the ceremony will work from it.

Until then, adding a `*.xend.global` origin (like `pay.xend.global`) requires no change here, and Checkout must never fetch or depend on this file at runtime.

## Ownership

Serving `xend.global/.well-known/webauthn` is an operations action on whatever infrastructure hosts the `xend.global` apex (DNS, web server, or CDN). No application in this repository serves that domain, so this document exists to record the contract and the trigger condition, not to ship code.
