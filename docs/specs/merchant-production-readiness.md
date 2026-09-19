# Merchant production-readiness sweep

## Scope

User-requested audit following the Account-page review on 2026-09-19.
This is an implementation backlog, not a production-readiness claim.
Keep global navigation at the top on every page. Developer settings may have
local navigation, but must not relocate the application navigation.

## Required next: real business profile

Implementation update: a business-profile form, owner-authenticated update
endpoint, additive local migration and profile-version conflict check are now
implemented. The real Account page shows the provider-verified sign-in email
separately from editable contact fields. A browser save of unchanged values
returned success; a direct local database read confirmed profile version 1 and
the submitted profile. No contact details were invented. Merchant component
tests pass (15); targeted backend validation/ownership tests pass (14).

Six HTTP + real PostgreSQL integration tests now pass using connection-local
temporary Merchant tables, leaving real records untouched. They verify persisted
reloads, owner isolation, one-winner concurrent saves, forbidden-field rejection,
authentication rejection and protection of verified legal names. The update
predicate also checks the observed KYB status to reject saves that race a change
in verification state. A regression now injects verification after the real
ownership read and before the real PostgreSQL update, proves a 409 response,
and verifies that the legal name and profile version remain unchanged.

Server validation details now reach the profile form and render beside the
affected inputs with `aria-invalid`/`aria-describedby`; editing clears stale
field errors and rejected submissions preserve input. Component coverage now
includes that path and malformed-error-payload handling (18 Merchant tests).

Unsaved form values now attach a browser leave/reload warning; sign-out asks
before discarding edits and is blocked while a save is in flight. Internal page
switches retain the mounted draft. Warning cleanup after cancel and unmount,
and the keep/discard sign-out choice, are covered by component tests (20 total).
Browser-native warning presentation, particularly mobile lifecycle limits,
still needs physical-device review; this is not durable draft autosave.

Still required before calling this production-ready: audit logging and
physical-device form review.
The backlog below records the original findings and must not be read as claiming
that every listed requirement has now been completed.

Evidence: `merchant-portal.controller.ts` exposes register, me, destination and
key issuance only. The Merchant schema stores names, origins, owner identity,
receiving wallet, verification status and settlement terms, but no business
contact/address profile. `main.tsx` displays only destination and KYB status.

- Return the owner's verified sign-in email from the Merchant identity service.
  Display it separately from editable contact email. A business-profile edit
  must not change authentication, recovery or account ownership.
- Add persisted business contact fields: contact name, contact email, phone,
  website and postal address. Distinguish trading/display name from legal name.
  Label unverified contact details accurately.
- Add an owner-authenticated, field-allowlisted update endpoint. Never accept
  owner IDs, verification status, fees or receiving addresses in its payload.
- Decide how verified legal-identity changes are reviewed before enabling those
  edits. Editing a profile must not silently invalidate or self-approve KYB.
- Build populated form fields with edit/save/cancel, inline validation, explicit
  saving/success/error feedback and protection against duplicate submissions.
  Preserve edits on failed saves. Handle stale edits/concurrent updates.
- Test unauthorized requests, cross-Merchant isolation, forbidden-field edits,
  validation, persistence after reload and rejected-save behavior.

## Other gaps found in the current portal

| Area                   | Current evidence                                                                                                                                                                                                                                                          | Missing production behavior                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Business verification  | Account shows pending/rejected/verified; live-key gate exists                                                                                                                                                                                                             | Submission/status workflow, reasons, resubmission and secure document handling if required by the chosen KYB process                                                                                                                                             |
| API key lifecycle      | Portal creates keys and shows fingerprints; owner-scoped revocation has confirmation, pending/error states and retained records. HTTP/PostgreSQL tests prove revocation, subsequent API rejection, idempotent retries and owner isolation                                 | Rotation, named keys, creation/last-use metadata                                                                                                                                                                                                                 |
| Webhooks               | API-key-authenticated endpoint management exists in `merchant-webhook-endpoints.controller.ts`; no dashboard screen                                                                                                                                                       | Owner-authenticated dashboard integration, endpoint validation, signing-secret lifecycle and delivery diagnostics                                                                                                                                                |
| Payments               | Portal returns only latest 20 intents; table has no detail view or pagination                                                                                                                                                                                             | Cursor pagination, dates, search/filter, exact currency/USDC quote details, confirmation reference and webhook delivery status                                                                                                                                   |
| Cancellation semantics | Browser Cancel returns a canceled result without mutating the intent. Local devnet intent `pi_jg7da6nqauy3im6c80iwmee3` remained `created` with zero attempts and zero Payments after cancellation                                                                        | Decide whether Cancel dismisses only this attempt (and should say so) or permanently invalidates the intent. Permanent cancellation needs an authorized backend transition with race handling; do not treat the current screen as proof of terminal cancellation |
| Navigation             | React state controls pages                                                                                                                                                                                                                                                | Stable routes, refresh/deep-link support and predictable back/forward behavior; top navigation must remain fixed in location                                                                                                                                     |
| Checkout disclosure    | User-approved native “More info” accordion contains the exact pinned USDC debit and expiry, collapsed initially. Fresh $1 devnet Checkout inspected in-browser: collapsed, expanded and collapsed again. No separate “Pay from” row. Expiry enforcement remains unchanged | Keyboard/mobile acceptance; no standalone exchange-rate field is currently returned in the Checkout summary                                                                                                                                                      |
| Production serving     | Vite dev proxy points to local backend                                                                                                                                                                                                                                    | Verify deployed same-origin/API routing, secure headers, environment separation and production smoke tests; dev proxy is not deployment proof                                                                                                                    |
| Profile security       | Ownership is verified on existing portal calls                                                                                                                                                                                                                            | Audit trail for sensitive business/integration edits, reauthentication policy and least-privilege data responses                                                                                                                                                 |
| UI verification        | Component tests and selected desktop/390px views checked                                                                                                                                                                                                                  | Full signup/profile/key/webhook/payment-detail/error/loading/empty-state and keyboard/mobile acceptance coverage                                                                                                                                                 |

## Deliberate V1 exclusions

No fiat movement, automatic conversion, bank payout or automatic refund.
Mainnet execution and above-limit device testing remain deferred by the user.
Do not turn those exclusions into simulated production capabilities.

## Acceptance

Entry-page update, 2026-09-20: loading, login and setup use a shared
black-information/white-action split layout, with the Xend v1 mark on the right.
No workspace navigation mounts until an account is loaded. The entry action is
“Continue”. Session readiness gates the entire entry/dashboard surface, avoiding
the signed-out flash during restoration. The actual browser reload was observed
in the split loading state and then the restored dashboard. Component coverage
checks branding, navigation absence and readiness transitions. Signed-out desktop
and 390 × 844 iframe views were inspected on the alternate local hostname without
logging out the existing Merchant session: no navigation, one Continue action,
visible branding and no clipped entry content. Setup-form visual acceptance for
a newly authenticated Merchant remains outstanding; iframe checks are not
physical-device acceptance. The latest Merchant suite passes 27 tests and its
production build passes.

Latest incremental verification: 46 backend tests covering Merchant ownership,
key issuance/revocation, API-key guarding and the entry-route inventory; 23 Merchant
component tests; 69 Checkout tests; eight opt-in HTTP/PostgreSQL profile and key
tests; Merchant and Checkout typechecks; and the backend build pass.
The latest full backend run passed 986 tests across 98 suites. Merchant and
Checkout production builds also pass with the latest key-management and
collapsed-disclosure changes. The existing large vendor-chunk warning
remains in the Merchant build. Desktop and 390px profile layouts were inspected;
those are browser layout checks, not physical-device acceptance.

Profile changes survive a browser reload and are isolated to the authenticated
Merchant. Every visible action has a real authenticated backend operation or
an explicit unavailable explanation. No placeholder success, invented metrics,
editable verification status, or frontend-only profile saves. The full pilot
and its mainnet proof remain separate, unfinished acceptance gates.
