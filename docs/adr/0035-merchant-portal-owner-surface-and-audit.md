# 0035: Owner-authenticated merchant portal surface, audit trail and least-privilege reads

**Status:** Accepted
**Date:** 2026-09-20
**Deciders:** Pay with Xend
**Tags:** backend, security, merchant

## Context and Problem Statement

The portal API exposed registration, profile, destination and key issuance under
the owner's provider identity, but webhook management existed only under an API
key, payments were a fixed latest-twenty read with no detail, API keys could not
be named or rotated, there was no owner-visible record of sensitive changes, and
the dashboard returned the full Merchant row, including the owner provider id.
The production-readiness sweep requires an owner-authenticated dashboard for
webhooks and payments, key lifecycle beyond issue and revoke, an audit trail for
sensitive edits, and least-privilege responses.

## Decision Drivers

- The owner identity is the portal's authentication boundary; it must resolve the
  same way for every portal route.
- The webhook endpoint lifecycle (SSRF validation, secret rotation, soft
  disable) already exists; the portal should reuse it, not reimplement it.
- Sensitive changes need an owner-visible, append-only record, separate from the
  operator audit log that must never reach a merchant.
- A read endpoint should return the merchant's own business data, never the
  credential that authenticates it.

## Considered Options

1. **Shared owner resolver plus dedicated portal controllers, reusing the
   existing services.** One `MerchantOwnerService` resolves the owned merchant;
   thin controllers for webhooks, payments and audit delegate to the existing
   `WebhookEndpointService`, `KeyIssuanceService` and a new audit service.
2. **One large portal controller.** Fold every route into the existing
   `MerchantPortalController`.
3. **Reuse the API-key webhook controller for the portal.** Authenticate the
   portal with an API key instead of the owner identity.

## Decision Outcome

Chosen option: **a shared owner resolver plus dedicated portal controllers.**
`MerchantOwnerService` defines the identity boundary once, so every portal route
resolves the owner and maps provider outages to the same HTTP codes. Webhooks,
payments and audit each get a small controller under `/merchant-portal`:

- Webhooks reuse `WebhookEndpointService`, so SSRF validation, dual-secret
  rotation and soft disable are identical to the API-key surface; only the
  authentication differs. Delivery diagnostics are read after ownership is proven.
- Payments are keyset-paginated on `(createdAt, id)` with status and reference
  filters, and a detail route returns the quote, the confirmation reference (the
  settlement transaction signature), and the webhook delivery status for the
  intent's correlation id.
- API keys gain an optional name and a rotate action (issue a successor under the
  same mode and name, linked to its predecessor, then revoke the old key), with
  creation and last-use metadata surfaced on reads.
- A new `merchant_audit_log` records profile, key, webhook and KYB writes; the
  owner reads their own trail through `/merchant-portal/audit`. It is separate
  from `admin_audit_log`, which stays operator-only.
- A serializer (`merchant-portal.view.ts`) drops the owner provider id and other
  server-only columns from every response, and secrets appear only once, on
  creation or rotation.

Option 3 is rejected because the portal owner is a person signing in, not a
server holding an API key; binding dashboard management to an API key would put
key material in the browser.

### Consequences

- Good: one identity boundary, reused services, and a clear least-privilege
  response shape.
- Good: the owner has a visible record of who changed what and when.
- Bad: several small controllers instead of one, which is more files but keeps
  each route surface readable and testable.

## More Information

- Source: `apps/backend/src/merchant/merchant-owner.service.ts`,
  `merchant-portal-webhooks.controller.ts`, `merchant-portal-payments.controller.ts`,
  `merchant-portal-audit.controller.ts`, `merchant-audit.service.ts`,
  `merchant-portal.view.ts`.
- ADR 0017 for the webhook contract the portal manages.
