# Pay with Xend USDC pilot

## Current status, 2026-09-20

This section supersedes conflicting historical UI checkpoints below.

- The Merchant application fills the viewport, retains top-level navigation
  across pages, and stretches the Developers panel to available height above
  the footer. Only the Developers settings navigation is a local sidebar.
- Business details have a persisted owner-authenticated edit form, verified
  sign-in email, validation, optimistic concurrency and verified-legal-name
  protection. Unsaved edits are guarded on sign-out and browser unload.
- Owners can revoke their API keys after confirmation. Revoked records remain
  visible, subsequent API use is rejected, and retries retain the first timestamp.
  Simulation keys move no funds; devnet execution keys move test USDC.
- The user chose a collapsed “More info” disclosure instead of prominent
  account/debit rows. It contains the exact pinned USDC debit and quote expiry.
  Fresh devnet Checkout `pi_jg7da6nqauy3im6c80iwmee3` was inspected collapsed,
  expanded and collapsed again, then dismissed without approval.
- Cancel currently dismisses the browser attempt, not the server intent.
  The database showed that reference still `created`, with zero attempts and
  zero Payments. Permanent invalidation would change the existing contract
  and is awaiting a user decision. Browser results never authorize fulfillment.
- Verification: 986 backend tests across 98 suites, 23 Merchant component tests,
  69 Checkout tests and eight isolated HTTP/PostgreSQL profile/key tests passed.
  Backend, Merchant and Checkout builds passed. Checkout entry size is 61.52 kB
  gzipped against a 75 kB limit. Large vendor-chunk warnings remain.
- No real key was revoked and no Payment was signed or submitted during these
  UI/key-management checks. Mainnet and above-limit device tests remain deferred.

Remaining production gaps and evidence limits are tracked in
[Merchant production readiness](merchant-production-readiness.md). These checks
do not establish physical-device acceptance, pixel-identical visual fidelity,
production KYB or the original mainnet completion criterion.

## Latest review findings, 2026-09-19

This section supersedes the older UI checkpoint where the current tree differs.

- The Merchant developer workspace now uses separate application and Settings
  sidebars on desktop, following the supplied CloseCRM reference. At 390 CSS
  pixels it retains top navigation and a single content column. Both layouts
  were inspected in the browser. Guide selection now updates both navigation
  controls, and current-page semantics are exposed to assistive technology.
- Merchant verification now passes 12 component tests, including exact raw-USDC
  totals, exclusion of simulated/failed Payments from received volume, empty
  accounts and navigation callbacks. Production build and typecheck pass.
- Current `PaymentSheet.tsx` has the Account row and `PaymentQuote` render
  commented out. The exact USDC debit and pinned expiry are therefore absent
  from the shared purchase sheet. This contradicts the approval-disclosure
  requirement despite all 68 Checkout tests and its typecheck passing. Those
  tests do not establish that the required disclosure is visible. Restoration
  was proposed to the user before modifying these potentially concurrent edits.
- The supplied `IMG_3305.MOV` shows the earlier cross-device passkey QR flow
  ending with Android's “No passkeys available” message. It does not capture
  the subsequently reported Privy transaction modal. The live Checkout link
  inspected in this review was expired, so that modal remains unreproduced.
- No Payment was approved, no API key issued, and no signing behavior changed
  during these checks. Full visual fidelity and mainnet completion remain
  unproven.

## UI review checkpoint, 2026-09-19

The user deferred mainnet testing and above-limit testing, and requested Merchant
and Checkout UI work. The full mainnet completion criterion remains unproven.

Design references inspected in the browser:

- [Earnify Merchant dashboard](https://dribbble.com/shots/26756914-Earnify-Merchant-Dashboard-UI): top navigation and compact summary cards.
- [CloseCRM developer hub](https://dribbble.com/shots/27542726-CloseCRM-API-keys-SDKs-developer-hub-UI-design): individual API-key cards and clear key environments.
- Checkout uses Xend-branded payment sheets, not Apple branding or a simulated native biometric prompt.

Implemented and verified in this UI pass:

- Returning Merchant sessions automatically load their account. Only a 404
  displays signup; authentication/server errors offer retry. Requests are
  aborted on identity changes and old account data is hidden immediately.
- Summary cards use recent confirmed, non-simulated Payments, explicitly not
  account Balance or all-time revenue. Chowderr rendered two confirmed devnet
  Payments totaling 1.751544 USDC, one active API key and pending verification.
- API cards display fingerprints, not retained secrets. New-secret copy feedback
  and clipboard-denial guidance are implemented but were not exercised against
  a newly issued key during this pass.
- Merchant desktop and 390-pixel iframe layouts were visually inspected.
  Corrected clipped mobile navigation and retained the USDC settlement disclosure.
- Actual SDK redirect created an unapproved USD 1 quote
  `pi_no28qizgpxljfr4grpo3vg2p`. Checkout rendered Chowderr, USD 1, USDC 1 and
  the pinned expiry. The local cancellation result was observed without approval.
  This does not prove server-side cancellation or invalidate a reusable intent.
- Checkout's actual 390-pixel iframe layout was visually inspected. These are
  responsive browser checks, not physical-phone or passkey interoperability tests.
- All Checkout states share payment-sheet styling. The signing-disabled build
  explicitly reports that no Payment was submitted, never simulated success.
- Approval is disabled at quote expiry, checked again on click, and does not
  relabel in-flight approval as expired. Cancellation is disabled during approval.
- SDK dialogs have accessible names, keyboard focus cycling/restoration and
  reduced-motion/transparency styles. Backdrop/Escape cannot emit cancellation
  after handoff; Checkout owns the subsequent payment result.

Verification at this checkpoint: Merchant 5 tests, Checkout 68 tests, SDK 72 tests
(145 total) passed. Affected typechecks and builds passed. Checkout entry passes
the 75 kB gzip size gate at 61.52 kB. Git diff whitespace check passed. SDK IIFE
was rebuilt. No commits, pushes, new keys or funds movement in this UI pass.

Review pages: `apps/merchant/ui-review.html` and `apps/checkout/ui-review.html`
embed real local applications at phone width; the Checkout page forwards the
query string from a pilot URL. They are development review entry points and are
not included by the default production single-entry build.

Remaining: user visual sign-off against the references; physical-device
revalidation; new-key clipboard interaction verification. Mainnet Consumer
identity/provisioning, Merchant KYB, provider suitability and fee funding gates
documented below remain deferred, not bypassed. No mainnet completion claim.

Follow-up: API key disclosure now has three component interaction tests using
an explicit example key and mocked clipboard, covering successful copy,
permission denial without false success, and dismiss removing the secret from
the view. Merchant now passes 8 tests; no actual key was issued or copied for
this test. The native-browser clipboard permission interaction remains untested.

## Devnet evidence update, 2026-09-19

This update supersedes older unverified entries below only where explicitly proven.
Mainnet completion is still outstanding.

- Payment `pi_tank9qh4hdxrbxjeazbu2zeb` settled 1000000 raw USDC to Chowderr.
  Signature: `3R6BBqDSqfqvCughiTRUDu2orvBjpAXgJBKAi1BEXuRc4QTXArQ5hs9H1F8A1EgufdSecuFfDtRcXmJuhegznyJK`.
- The local database has exactly one matching confirmed SEND Activity, kind
  `payment`, linked to `pay_jjd78nqexav8wpi0bn43p0od`. This proves indexing,
  not the rendered phone screen.
- No Merchant endpoint existed at original settlement. After registering local
  endpoint `t0lseurzxtu9nqmb1wdtnphn`, the original `payment.succeeded` Kafka
  event was read and replayed through the existing backend dispatcher.
- Event `evt_61ecf7a6809a3fd15127a775` was delivered over verified local HTTPS
  and accepted with HTTP 200 by the real SDK signature verifier. Its Payment ID,
  signature and raw amount match the settled Payment. A second delivery returned
  `duplicate: true`. Neither operation invoked settlement or sent funds.
- Receiver tests pass for missing, tampered and stale signatures, signed event-ID
  deduplication and oversized-body rejection. This is an ephemeral local receiver,
  not durable production Merchant fulfilment infrastructure.

### Local webhook harness

From `apps/merchant`, run `node --env-file=.env.local pilot-webhook.mjs`.
The Merchant API key remains server-side. The receiver registers a fixed local
HTTPS endpoint and retains its signing secret in memory, never in browser code.
On restart, explicitly add `--rotate-local-secret` to rotate that endpoint's
secret. The receiver listens on loopback port 5175; Checkout Vite proxies
`/pilot/webhook` to it. Run tests with
`node --test apps/merchant/pilot-webhook.test.mjs` from the repository root.

The sending Node process must trust the local mkcert CA via
`NODE_EXTRA_CA_CERTS`, and local development must enable
`WEBHOOK_ALLOW_PRIVATE_URLS`. Never disable TLS verification. Production must
retain the private-address blocker. The replay process had this CA configured;
the long-running backend still needs its trust configuration checked before
testing automatic delivery on a fresh Payment.

### Fresh NGN Payment and automatic delivery

The backend was restarted with trusted local CA configuration. A first NGN
pricing attempt timed out at the configured 3000 ms and did not charge funds.
Two subsequent read-only provider probes succeeded in 594 ms and 185 ms, so
no timeout or static fallback change was made. Retrying the same pilot order
through the real SDK succeeded:

- Intent: `pi_b9d0a3eenavvm2epplb78fx9`; Payment: `pay_kubfzb4xxl7qvqt1icj5s3rc`.
- Price: NGN 1000.00; Blockradar reference rate: 1330.5948508474216 NGN/USDC;
  exact debit: 751544 raw USDC (0.751544 USDC).
- Signature: `5u2spDeT3nAiE1PpzsUfFwwKPCfHYS67WzKLon3AdY6becRoy6PbnahmCW2SZhvqMKutH3dov1b6WDWHuJXfsxK9`.
- Devnet slot 500930532, chain error null, fee 10000 lamports. Consumer vault
  balance changed from 1500000 to 748456 raw; Merchant balance changed from
  1000000 to 1751544 raw. Both use the canonical devnet USDC mint.
- Automatic webhook `evt_cfde9f142aa30e94bd5bdcad` received HTTP 200 and
  `duplicate: false`. No replay was used for this Payment.
- The Merchant pilot page displayed the real SDK's `succeeded` result for this
  intent. Unlike the earlier USD test, no manual redirect URL was opened.
- The Activity row was still absent in the immediate follow-up checks.
  Source inspection shows a five-minute replay sweep for missed chain webhook
  deliveries, while the 30-second poll only updates existing pending rows.
  The 15:50 UTC sweep subsequently created exactly one confirmed Payment
  Activity, proving a roughly three-minute indexing delay rather than a lost
  transfer. The new independent `payment-activity-indexer` Kafka consumer
  triggers the existing chain replay promptly on `payment.succeeded`, checks
  that confirmed Activity exists before acknowledging, and propagates transient
  errors for retry. It skips simulated signatures and does not send funds.
  Fifty-one focused Activity tests pass; fresh-event latency and the phone
  display still need end-to-end verification.

### Negative-case browser evidence

The local Merchant harness now offers an explicit full-page redirect option
(`?presentation=redirect`) using the real SDK. Popup remains the default.

- Insufficient Balance: `pi_rigp88aj6i4ccp259jrkh2gm`, USD 10.00, was launched
  through the SDK redirect flow. Confirming showed "Not enough Cash".
  The database remained `created`, with zero payment attempts and zero payments.
- Cancel from that refusal showed "Payment canceled". This is cancellation of
  the current Checkout interaction, not durable invalidation of the intent:
  the current frontend cancel path sends no backend cancellation request.
- Previously expired devnet intent `pi_s444gtanax9fdp5obp87he0c` displayed
  "This payment link is no longer active" with no approval control. No expiry
  timestamps were modified. This covers opening an expired link, not expiry
  during signing or ambiguous in-flight submission.

Still unproven: timely/rendered Consumer Activity, above-limit device approval,
remaining negative/retry E2E cases (including in-flight expiry and retries),
Merchant verification and mainnet settlement.

### Settled transaction retry evidence

Reposting the exact on-chain transaction bytes for the successful NGN Payment
initially returned HTTP 500: the settlement service could no longer find a live
attempt. Checkout now returns persisted terminal outcomes before submission and
also rechecks them if confirmation wins during the submission lookup. A failing
regression was reproduced before the change; all 30 controller tests and the
backend build then passed.

After restarting the backend, two identical `/checkout/settle` retries returned
HTTP 201 with `status: succeeded`. The database still contains exactly one
Payment and one attempt for this intent. Chain balances remained Consumer
748456 raw and Merchant 1751544 raw USDC. This proves completed-Payment retries;
it does not yet prove simultaneous first submissions or in-flight expiry.

### Concurrent-submission regression

A new two-caller test reproduced both callers reaching the signer/broadcaster
before either persisted the signature. Submission now takes the existing
Postgres advisory lock keyed by intent before reading the live attempt. The
second caller observes and reconciles the recorded signature. The test passes
with exactly one submit and two fulfilled responses. This is a service-level
concurrency test with a serialized lock double, not a live multi-process proof.
An additional test verifies that an already-broadcast retry still reconciles
after quote expiry without signing or broadcasting again. Fresh broadcasts
after expiry remain refused.

Latest regression: 975 backend tests across 97 suites pass; backend and Checkout
production builds pass. Mainnet and fresh device confirmation remain unproven.

### Seeker visual verification

On the connected Seeker, Activity visibly shows both settled Payments as
"Paid / Chowderr" and the original 2.5 USDC deposit. The NGN Payment detail
shows Completed, Merchant address `9jFU...wAsN` and transaction `5u2s...sxK9`,
matching the independently verified chain data. The Account screen shows a
rounded $0.75 remaining balance. Screenshots from this run are in
`/tmp/xend-device-check.YPTCf4/` (ephemeral local evidence).

Two visible rough edges remain: a recurring development error toast and a
detail timestamp shown as 5:50 PM while the device clock is 5:06 PM. The detail
also rounds 0.751544 USDC to 0.75 USDC. Do not represent the device experience
as fully polished or the event-driven indexing latency as proven by these
already-indexed rows.

Chowderr's current database KYB status is still pending with no verified-at
timestamp. USDC terms acceptance is recorded. Mainnet remains gated.

### Mobile issues resolved during visual testing

The Payment detail now uses confirmed chain time instead of index insertion
time. On the Seeker the same NGN Payment changed from the incorrect 5:50 PM
to 4:46 PM, matching its chain confirmation. This does not repair the broader
database mix of local-time defaults and UTC timestamp values or change feed
pagination semantics.

The error toast revealed Android rejecting GET requests with a body. Both
`listAwaitingPayments` and `paymentStatus` omit the method, but the shared
client incorrectly treated that as a write and inserted `{}`. Two failing
call-site regressions reproduced it. The client now handles omitted-method
GET and HEAD as bodyless. After hot reload, the actual phone request to
`GET /payments/pending` reached the backend and returned 200. All 66 focused
mobile Activity/API tests and the mobile typecheck pass. This restores reads;
it is not yet proof of the above-limit signing ceremony.

### Remaining execution gates, read-only audit

The current Consumer's devnet policy was read from chain: 100000000 raw USDC
per use and per daily period, 98248456 raw remaining in the period. Available
Balance remains 748456 raw. An above-limit funded Payment therefore needs
additional devnet funding or an explicitly approved temporary limit change.
No limit was changed.

Mainnet public-address reads found the selected fee payer has zero SOL and the
Merchant's mainnet USDC ATA `67qUnScDqCymSDdFBnQZRrYLGYekM3CSq6YgwwtwrZw3`
does not exist. The derived Consumer USDC ATA
`GqW4eiSKYa5RNqtBHXRsUPdASts4QjfwbEMfKkacf55q` and Squads settings account
do exist, but their signer identity/control has not been verified for this
Consumer on mainnet. Existence alone is not readiness or authority to spend.
No mainnet state was changed. Merchant KYB remains pending.

Full mobile regression: 182 tests across 17 suites pass.

### Critical mainnet identity mismatch

Reading the Squads signer sets at the recorded settings address on both
networks proved that devnet contains the selected Consumer's primary and
approval signers (three total signers), while mainnet contains neither (four
total signers). The same program counter seed can identify different Accounts
on different networks. The existing mainnet Account is NOT this Consumer's
verified Account. Do not fund its derived vault for this pilot or switch the
existing devnet database/configuration to mainnet and assume identity carries
over. Mainnet requires separately provisioned and verified Account records,
plus the missing fee reserve, Merchant destination and legitimate KYB approval.

Approved scope: 2026-09-15. Implementation and mainnet verification are in progress.

This pilot supersedes ADR 0023's convert-at-settlement assumption: Merchants
receive USDC in a Merchant-controlled Solana account. NGN is a pricing currency,
not a promise of bank proceeds. Fiat funding, conversion, bank payouts and
automatic refunds are outside this pilot. Retain historical adapters for later
work, but reject fiat settlement before building or submitting a Payment.

## Required flow

1. Create the Merchant's receiving wallet during authenticated onboarding,
   initialize its canonical USDC token account, and verify ownership. Complete
   business verification and record acceptance of USDC settlement before live use.
2. Fetch a verified live NGN/USDC reference quote, pin its source, timestamp,
   expiry and exact USDC debit. USD pricing must also produce an exact debit.
   Never use a static or sandbox quote for a live mainnet Payment.
3. Show price and USDC debit before approval. Expiry requires renewed approval.
   Preserve the phone approval notification, banner and Activity path.
4. Transfer from the Consumer's Account to the Merchant's verified destination.
   Confirm on chain, deliver the Merchant webhook and record confirmed Activity.

## Completion evidence

- Actual mainnet signature, verified Consumer and Merchant addresses, exact
  before/after USDC balances, matching Payment and webhook outcome.
- Device/browser verification of approval and confirmed Activity.
- Insufficient Balance, cancellation, expired quotes and duplicate/retry checks.
- No fiat provider execution or simulated success in the live flow.

## Current dependencies

Blockradar reference pricing is implemented behind FX_QUOTE_SOURCE=blockradar,
using the exact USDC/NGN pair at /v1/assets/rates. Contract tests cover invalid
pairs, zero/negative rates and missing credentials. The explicitly authorized
read-only probe succeeded on 2026-09-15 using the supplied test credential,
returning 1325.2060785171939 NGN per USDC. This proves reference pricing access,
not production credentials or an executable exchange quote. Do not interpret
this reference price as a bank payout guarantee.

Implemented safeguards include rejecting fiat settlement before prepare/submit,
rejecting static mainnet rates (including cached development quotes), displaying
the exact debit and expiry in Checkout and phone approval, and waiting for the
recorded settlement outcome before the phone reports success. These are covered
by focused tests, not yet by device or mainnet execution evidence.

The new apps/merchant workspace and authenticated merchant-portal routes wire
signup to a provider-verified Solana wallet. The portal records USDC terms,
initializes that Merchant's receiving token account and gates live keys on KYB.
No Merchant registration or receiving account has yet been verified end to end.
Existing historical Xend-controlled destinations are rejected by live settlement.

The Paga/Nomba/Consumer fiat PRs (#96, #97, #98) remain sandbox integrations and
are not dependencies of USDC settlement. Mainnet identity, funding, Merchant
verification and fee payer readiness remain to be verified.

## Evidence audit, 2026-09-15

| Requirement                                 | Evidence and remaining gap                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merchant signup and receiving wallet        | Dedicated Merchant Privy authentication works after enabling identity tokens. User-authorized test Merchant Chowderr created through dashboard; receiving wallet 9jFUhds78NM9Mq2FPScU1SxyPB9pRrvVbXbno6CFwAsN.                                                                                                                                            |
| USDC receiving token account                | Initialized on devnet and ownership confirmed by backend on idempotent retry: Gn76Neg2oANt8T9pgqc2DshUkDj6QApWtda21M7TZiQZ. Dashboard shows Ready to receive. First immediate ownership read was unconfirmed; portal now maps that typed error to a retryable conflict (tested, not yet restarted).                                                       |
| Verification and USDC terms                 | Chowderr acknowledged the USDC-only disclosure. Business verification is still pending, not represented as completed by test signup. Existing manual KYB gate precedes execution keys, including devnet.                                                                                                                                                  |
| Live NGN pricing                            | Blockradar reference adapter contract tests and authenticated pricing probe pass with the supplied test key. Production credential suitability remains unverified.                                                                                                                                                                                        |
| Price and debit disclosure                  | Checkout and phone display exact USDC debit and intent expiry. Checkout builds. Device/browser appearance has not been verified.                                                                                                                                                                                                                          |
| Explicit USD-priced API requests            | Implemented: currency=USD takes cents at the pilot denomination of one USDC per USD; currency=USDC retains six-decimal raw units. Original pricing currency is stored and preserved in create, GET and webhook responses. Additive migration applied locally. Controller/webhook tests cover the distinction; actual USD checkout E2E remains unverified. |
| Quote expiry                                | New broadcasts reject expired intents; in-flight attempts can still reconcile. Focused settlement tests pass.                                                                                                                                                                                                                                             |
| Phone approval                              | Matching primary signer selected; pending status polled with Consumer ownership enforcement. Confirmation tests pass. No actual device approval performed.                                                                                                                                                                                                |
| Settlement, webhook, Activity               | Existing implementations and regression tests exist. No matching mainnet signature, balance deltas, webhook delivery or rendered Activity evidence.                                                                                                                                                                                                       |
| Cancellation, insufficient Balance, retries | Existing and added tests provide partial evidence; live end-to-end cases are outstanding.                                                                                                                                                                                                                                                                 |
| Fiat blocker                                | Prepare/submit reject non-direct-USDC providers. Existing historical provider code remains, so this is a Payment route restriction rather than removal of every fiat API.                                                                                                                                                                                 |

Full backend regression: 929 tests passed and one route-inventory test identified
the newly added status route. Its explicit closed-to-entry classification was
added; all 14 route-inventory/pending-payment tests then passed. Checkout's
production build passes. These results do not prove mainnet or device readiness.

Latest local configuration remains devnet with forced settlement disabled.
Mainnet Consumer/Merchant selection and the authorized test spend have not been
provided. Do not change network or initiate real transfers by guessing them.

The rate-precision integration regression is fixed: Merchant intent creation
uses the greater of the configured scale and the quoted fractional precision,
preserving the quoted string and rounding only the final raw USDC amount.
A failing controller test using the observed 13-digit fractional rate now
passes. A fresh authenticated probe at 2026-09-15T14:34:23Z returned
1325.0317206176758 NGN per USDC and calculated 800000 kobo as 6037591 USDC raw.
The probe is read-only; it does not establish Payment creation or settlement.

No undisclosed USDC surcharge has been added. The read-only
scripts/check-payment-fees.ts probe verified the configured devnet fee payer
at slot 498712871: 757532715 lamports available against an illustrative
12488440-lamport budget (10000000 reserve, 1000000 fees and 1488440 rent for one
classic SPL token account). This is a snapshot, not a concurrency-safe reserve
or an exact transaction fee estimate. Recheck before the ceremony; production
reserve policy remains undecided. Test API keys simulate Payments; they are
not evidence of a devnet transfer. Merchant KYB has not been marked verified.
