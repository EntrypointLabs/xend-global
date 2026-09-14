# Credential-free fiat probes

Date: 2026-09-08, approximately 21:54–21:56 UTC. Actual HTTP probes, no supplied credentials, no production mutations and no real funding. Reproduce with `node apps/backend/scripts/probe-public-fiat.mjs`. Script outputs redacted summaries; it does not load environment files or enable providers.

| Provider / request                                                    | Observed result                                                      | What it proves                                                              |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Nomba POST sandbox /v1/accounts/virtual                               | HTTP 200, account-shaped response, NGN, echoed reference             | No-auth creation response available, not proven persistent customer account |
| Nomba GET virtual account just returned                               | Different account number and demo name                               | Read-back did not establish persistence                                     |
| Nomba POST sandbox /v2/transfers/bank, nine-digit account             | HTTP 422, requires ten digits                                        | Input validation works; published quickstart's nine-digit example fails     |
| Nomba same endpoint, synthetic ten-digit account                      | HTTP 200, PENDING_BILLING                                            | Request accepted by test endpoint only                                      |
| Nomba exact retry with same merchantTxRef                             | Different transaction ID, PENDING_BILLING                            | No reliable idempotency demonstrated                                        |
| Nomba GET single transaction with documented transactionRef           | SUCCESS with matching ID but unrelated merchant reference            | Cannot trust this alone as persisted settlement                             |
| Nomba same requery with never-created synthetic reference             | SUCCESS, echoes nonexistent ID                                       | Strong evidence of fixture-style responses; not an end-to-end transfer test |
| Nomba GET sandbox /v1/transfers/bank                                  | System error JSON code 500; HTTP status not captured in initial call | Public bank-directory route did not succeed in that probe                   |
| Paga GET beta-collect.paga.com/banks                                  | HTTP 401, Error validating hash                                      | Access requires signing/authentication                                      |
| Flutterwave GET developersandbox-api.flutterwave.com/banks?country=NG | HTTP 401, UNAUTHORIZED / 10401                                       | No anonymous access on tested endpoint                                      |
| Paystack GET api.paystack.co/bank?country=nigeria                     | HTTP 200, bank directory                                             | Public read-only metadata accessible                                        |
| Paystack GET api.paystack.co/dedicated_account                        | HTTP 401, No Authorization Header was found                          | Account resource needs credentials                                          |

An initial Nomba requery used the wrong parameter `transactionId`; discard that result. The corrected `transactionRef` and nonexistent-reference control above establish the limitation. Do not poll unrelated fixture IDs or expose sample identity data. No callbacks, real receiving deposits, production approvals, authenticated tenant isolation, refunds or actual USDC conversion were tested.

## Authenticated Nomba and simulator: 2026-09-14

The founder explicitly selected Nomba and authorized the fallback sandbox credentials. This supersedes the older Paga-first/Nomba-on-hold notes below. Credentials are stored only in the ignored backend environment.

| Check                                      | Observed result                                                                     | What this establishes                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| OAuth issue                                | HTTP 200, code `00`                                                                 | Fallback credentials authenticate                                                     |
| Bank directory                             | HTTP 200, 77 banks at `/v1/transfers/banks`                                         | Corrected the adapter's singular `/bank` path                                         |
| Per-user virtual account create            | Active account persisted through `NairaAccountsService`                             | Account provisioning works with this sandbox tenant                                   |
| Authenticated account read-back            | Reference, account number, name, NGN currency and parent all match; `expired=false` | The new account reader can recover the existing account without another create        |
| Never-created virtual account              | HTTP 404                                                                            | Negative account control rejects an unknown reference                                 |
| Mobile account screen                      | Active Nomba account displayed on iPhone simulator via `/dev/fiat/banking/accounts` | Mobile → running backend → persisted provider coordinates works without passkey login |
| Parent balance                             | Endpoint returns an NGN amount                                                      | This is a business balance, not any user's available balance                          |
| One ₦100 sandbox bank payout               | HTTP 200, `PENDING_BILLING`, matching amount/reference/destination on submission    | Adapter accepts the submission as pending sandbox evidence                            |
| Requery of that payout                     | `SUCCESS`, matching reference but different beneficiary account and bank            | Adapter correctly rejects it with `NOMBA_TRANSACTION_MISMATCH`                        |
| Two never-submitted transaction references | `SUCCESS`, including an echoed nonexistent ID                                       | Authenticated transaction status still exhibits fixture behaviour                     |
| NGN/USD exchange-rate read                 | Returns NGN/USD and NGN/GBP pairs                                                   | Does not establish executable NGN↔USDC conversion or Solana settlement                |

The payout was submitted once using Nomba's published test recipient, with no automatic retry. No user balance was debited or credited from it. Its local probe journal is `/tmp/xend_eb3dd3c6a1e34aef8bb9.json`. No live-money API was called.

Nomba's [account guide](https://developer.nomba.com/docs/guides/managing-accounts-with-nomba) distinguishes pooled virtual accounts from subaccounts that hold money. We must attribute verified deposits to Xend owners and reserve their own funds before paying from the parent account. The observed-balance screen therefore returns `CUSTOMER_BALANCE_UNAVAILABLE` for Nomba and `VAULT_UNAVAILABLE` for the local demo identity, which has no devnet vault. It does not display the business balance as the customer's money. The account screen only links to the Paga-specific transfer flow when Paga is selected.

Repeat the read-only authentication, directory, account-recovery and nonexistent-reference controls from the repository root:

```sh
node --env-file=apps/backend/.env apps/backend/scripts/probe-nomba-authenticated.cjs --local-account
```

The command requires the backend on localhost:8008 and the existing dev identity's Nomba account. Omit `--local-account` to run provider controls without the local backend. It prints no credentials or bank coordinates and performs no account creation, payout or ledger mutation. A successful process exit means the probes ran; inspect the observations, because it always reports `settlementVerified: false`.

Current runtime: Redis and Kafka restored, backend at localhost:8008, Metro at localhost:8081, Xend dev client on the iPhone 17 simulator. Open `bright:///accounts` for the provider account and `bright:///balances` for observed holdings. The unified simulation remains separate.

Still required for the complete consumer flow:

1. A provider-supported way to fund a specific sandbox virtual account, plus an authenticated credit requery identifying that account, amount, currency and unique transaction. Confirm a negative reference cannot report a matching successful payment.
2. Durable owner-attributed NGN credits, debit reservations, reconciliation and payouts integrated into the consumer API. Parent-account balance is insufficient evidence.
3. A working NGN↔USDC quote/order/settlement provider and devnet vault signing through the existing spending controls. Nomba fiat USD quotes do not provide this contract.
4. Wire those verified legs into unified execution, demonstrate destination-asset-first spending and shortfall conversion, and show reconciled balances after completion and failures. Future Pay With Xend must use those same funding guarantees.

### Follow-up: a documented ₦100 deposit test and durable callback receiver

The [virtual-account guide](https://developer.nomba.com/docs/products/accept-payment/virtual-account) explicitly describes funding a sandbox virtual account with exactly ₦100 from a Nigerian bank, a maximum of two sandbox virtual accounts, and sandbox webhook delivery. It allows an expected amount between ₦100 and ₦150. This is a more specific test procedure than the general sandbox environment description. It has **not yet been performed** on our account. Read-back confirms our account is active, but does not return an `expectedAmount` field; do not treat absence of that field as permission to test larger amounts.

Implemented `POST /webhooks/nomba/sandbox` in the running backend and migration `0046_bank_notifications`. The receiver verifies HMAC, freshness and the configured Nomba merchant before any write; retains only signed notification identities in a provider/environment-scoped durable inbox; handles concurrent duplicates and restarts; and rejects an event ID reused for different signed content. It returns a non-2xx response if persistence fails, allowing provider redelivery. It is disabled in production and when the selected provider credentials or webhook secret are missing.

Nomba's [signature algorithm](https://developer.nomba.com/docs/api-basics/webhook) does not include amount, fee, currency, virtual account reference or beneficiary. Those unsigned fields never become trusted inbox data. A received event is **not a credit**. The requery/credit worker is still outstanding pending a deposit response that establishes the correct account and amount. No notification has been received from Nomba yet.

Validation: 323 fiat tests across 24 suites passed, including eight real HTTP/PostgreSQL receiver cases. The running local backend accepts a signed non-payment connectivity probe with HTTP 200 and `ignored: true`, rejects an invalid signature with HTTP 401, and writes no payment for either probe. A sandbox webhook signature secret has been generated in the ignored backend `.env`; copy its `NOMBA_SANDBOX_WEBHOOK_SECRET` value into the dashboard's test webhook signature-key field.

The existing Xend development tunnel's health endpoint responds successfully. Its proposed callback URL is `https://unvertiginous-echinate-shawana.ngrok-free.dev/webhooks/nomba/sandbox`. An authenticated public connectivity probe is awaiting explicit user approval after automatic approval review rejected sending the account ID and HMAC signature through that URL. The existing tunnel has not been reconfigured.

Once the callback is verified, configure the **sandbox** webhook URL and matching signature key in Nomba, subscribing to payment success/failure/reversal and payout success/failure/refund. Then perform one exact ₦100 bank transfer to the active account shown in the simulator. Capture the provider notification, independently requery its transaction, and only implement the corresponding credit after matching the deposit to the persisted owner/account. Do not repeat a transfer simply because a webhook is delayed. No live API credentials, larger deposits or automatic ledger credits are enabled by this setup.

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
