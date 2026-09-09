# Credential-free fiat probes

Date: 2026-09-08, approximately 21:54–21:56 UTC. Actual HTTP probes, no supplied credentials, no production mutations and no real funding. Reproduce with `node apps/backend/scripts/probe-public-fiat.mjs`. Script outputs redacted summaries; it does not load environment files or enable providers.

| Provider / request | Observed result | What it proves |
| --- | --- | --- |
| Nomba POST sandbox /v1/accounts/virtual | HTTP 200, account-shaped response, NGN, echoed reference | No-auth creation response available, not proven persistent customer account |
| Nomba GET virtual account just returned | Different account number and demo name | Read-back did not establish persistence |
| Nomba POST sandbox /v2/transfers/bank, nine-digit account | HTTP 422, requires ten digits | Input validation works; published quickstart's nine-digit example fails |
| Nomba same endpoint, synthetic ten-digit account | HTTP 200, PENDING_BILLING | Request accepted by test endpoint only |
| Nomba exact retry with same merchantTxRef | Different transaction ID, PENDING_BILLING | No reliable idempotency demonstrated |
| Nomba GET single transaction with documented transactionRef | SUCCESS with matching ID but unrelated merchant reference | Cannot trust this alone as persisted settlement |
| Nomba same requery with never-created synthetic reference | SUCCESS, echoes nonexistent ID | Strong evidence of fixture-style responses; not an end-to-end transfer test |
| Nomba GET sandbox /v1/transfers/bank | System error JSON code 500; HTTP status not captured in initial call | Public bank-directory route did not succeed in that probe |
| Paga GET beta-collect.paga.com/banks | HTTP 401, Error validating hash | Access requires signing/authentication |
| Flutterwave GET developersandbox-api.flutterwave.com/banks?country=NG | HTTP 401, UNAUTHORIZED / 10401 | No anonymous access on tested endpoint |
| Paystack GET api.paystack.co/bank?country=nigeria | HTTP 200, bank directory | Public read-only metadata accessible |
| Paystack GET api.paystack.co/dedicated_account | HTTP 401, No Authorization Header was found | Account resource needs credentials |

An initial Nomba requery used the wrong parameter `transactionId`; discard that result. The corrected `transactionRef` and nonexistent-reference control above establish the limitation. Do not poll unrelated fixture IDs or expose sample identity data. No callbacks, real receiving deposits, production approvals, authenticated tenant isolation, refunds or actual USDC conversion were tested.

## Consequences for implementation

Nomba's [no-account sandbox](https://developer.nomba.com/docs/guides/try-the-api) is useful for request/response exploration. Keep the Xend-owned simulator and idempotency protection. Do not use this public sandbox as the oracle for balance, finality, duplicate handling or reconciliation. An authenticated partner environment must prove those behaviours before execution is enabled.

Paga's [authentication](https://developer-docs.paga.com/docs/authentication), Flutterwave's [authentication](https://developer.flutterwave.com/docs/authentication), and [Paystack API authentication](https://paystack.com/docs/api/) require account credentials for substantive operations. Repeated anonymous writes would not move the integration forward. Paga sandbox registration is linked from its [onboarding guide](https://developer-docs.paga.com/docs/create-an-account); use provider-issued sandbox keys when available, never illustrative documentation strings as credentials.

## New Paga evidence changes the account shortlist

[Subsidiary Accounts](https://developer-docs.paga.com/docs/subsidiary-accounts) now documents API-issued NGN balances with NUBANs, deposit limits, optional sweeping, and reference-based idempotency. The merchant legally owns the funds while operating for end users. BVN is optional in the schema; consumer verification requirements still need agreement. This is stronger account-product evidence than the earlier collection-only assessment. It does not prove USDsui or Solana conversion. These endpoints require public key, secret key and hashKey; execution remains untested.

Paga is therefore the first account-product validation candidate; Nomba is immediately explorable for fiat API contracts. Neither is launch-proven. Keep conversion and payout capabilities independent. Future Pay With Xend must never spend against a sandbox SUCCESS, an unreconciled NGN credit or a pending conversion.

## Recheck: 2026-09-09, 15:06–15:07 UTC

The actual `probe-nomba-adapter.cjs` network run again accepted account creation as `fixture` and payout submission as `pending` / `fixture`. Both the returned payout reference and a never-created reference failed exact reconciliation with `NOMBA_TRANSACTION_MISMATCH`. No real account funding or settlement was established. A first restricted-network attempt failed transport; those errors are not provider capability evidence.

The authorized `probe-fonbnk.mjs` discovery/quote-only run succeeded for both NGN → SOLANA_USDC and SOLANA_USDC → NGN. Both returned the devnet mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, and order-field metadata included sandbox forced-flow options. This is compatible with investigating devnet settlement next, but neither orders nor chain transactions were submitted in this recheck. The prior order-permission 403 remains unresolved, not freshly tested.

Local configuration presence was checked without displaying values: Fonbnk client ID and secret exist; Paga sandbox public key, secret key and hash key are absent; Nomba client ID, client secret and account ID are absent. These are observations of the local configuration, not a claim about accounts the founder may have elsewhere.

Both providers offer testing without real-money expenditure:

- [Paga sandbox registration](https://beta-business.paga.com/partner/uiv2/register), linked from [official onboarding](https://developer-docs.paga.com/docs/create-an-account). [Authentication documentation](https://developer-docs.paga.com/docs/authentication) says test-mode transactions move no actual value. We still need tenant credentials and to verify subsidiary-account and Business payout access, test balance provisioning, callbacks and reconciliation under that account.
- [Nomba environments](https://developer.nomba.com/docs/api-basics/environment) documents separate sandbox and production client credentials generated through its dashboard. Authenticated sandbox testing requires the corresponding client ID, client secret and account ID. Anonymous fixture behaviour does not establish authenticated tenant persistence.

The current banking adapters are explicitly sandbox-only; configuring keys alone does not enable live transfers. Paga subsidiary accounts currently document NGN only. The [Sui/Paga announcement](https://www.sui.io/blog/shaping-the-way-money-moves-across-continents-with-sui-and-paga) supports pursuing USDsui API access, but does not supply the executable conversion and external Solana USDC settlement contract required by Xend. Request the quote/order/status API, tenant entitlement, fee semantics, supported networks and test funding procedure before connecting it to real ledger execution.

## Paga credentialed probe: 2026-09-09, 22:33 UTC

The three Paga sandbox credential fields are now populated locally. The local selection is `FIAT_BANKING_PROVIDERS=paga` and `FIAT_NGN_ACCOUNT_PROVIDER=paga`; Nomba is on hold pending CAC. This supersedes the earlier observation that Paga credentials were absent.

`apps/backend/scripts/probe-paga-adapter.cjs` executed the actual Paga adapter against official sandbox hosts. Both the Business `getBanks` call and the Collect subsidiary-account negative read returned HTTP 401. A separate sanitized inspection of the Collect response reported `invalid username or password`. No account creation, top-up, payout or transfer was submitted. The keys may be invalid or belong to another environment; the response alone does not distinguish these causes. No live endpoint was probed.

The probe is read-only and logs neither credentials nor customer/provider payloads. Its optional `--account` argument checks retrieval and balance for an existing owned sandbox account. It never treats a rejected or nonexistent-account response as successful provisioning or settlement.

Current gaps remain: valid sandbox authentication; two persisted per-user accounts and funded sandbox balances; verified NGN debit/credit and bank payout; a contracted, executable NGN↔USDC converter; signed Solana execution; reconciled unified holdings and unified send. The consumer simulator is separate from these provider balances. Future Pay With Xend must consume the same verified funding and settlement evidence, rather than infer spendability from the simulator or this access probe.
