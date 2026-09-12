# Consumer fiat rails: launch research and proposed implementation

Latest founder revision: temporary virtual accounts are parked; investigate distinct NGN holding, reusable accounts and Paga/Sui/Crossmint, plus Bridge USD rails. See [revised naira-account proposal](consumer-naira-account-revision.md), which supersedes older launch prioritisation below. Historical provider recommendations are retained as research history, not the latest selection. No existing production balance model or cross-chain implementation changes are implied.

Status: research and proposal, not an accepted provider decision or a production readiness claim.
Date: 2026-09-08.
Scope: consumer app launch in three days (September 11 if the relative date is literal). Merchant launch is next week and is not a dependency of this release. Pay With Xend remains an architectural consideration only.

Code architecture and actual API access probe results: [consumer fiat code architecture](consumer-fiat-code-architecture.md). Authenticated Fonbnk sandbox quotes now pass both directions; sandbox order creation is blocked by account permission (HTTP 403). No funded or production route is proven.

## Current scope checkpoint: Receive and Send

Updated after the founder requested temporary/permanent fiat Receive, USDC ↔ NGN, and fiat ↔ fiat. These are requested capabilities; provider choices and the implementation paths below remain proposals. None is represented as production-ready.

| Capability                       | Intended flow                                                                                                                                                                          | Current position                                                                                                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Receive Fiat — temporary account | Create a payment-specific NGN account with provider-enforced expiry; receive the bank transfer; convert to native Solana USDC; credit the Consumer's Account after chain confirmation. | Short-TTL account is required by the product. Paystack has that primitive but eligibility/conversion remain gaps. Fonbnk is a ramp candidate, not a confirmed temporary-account issuer. No verified no-KYC NGN receiving route yet. |
| Receive Fiat — permanent account | Issue reusable bank details after required verification; support incoming transfers and the automatic-conversion preference.                                                           | Bread is the leading account-product inquiry. NGN-to-external-Solana delivery and manual conversion/NGN holding need proof. Sumsub is the proposed full-KYC integration, subject to the financial partner accepting it.             |
| NGN → USDC                       | Collect NGN and deliver USDC directly to the Consumer's Squads vault.                                                                                                                  | This is Receive/on-ramp, even though it is one half of USDC ↔ fiat. Fonbnk documents the component coverage; prove the exact route. Nigerian basic verification requires BVN.                                                       |
| USDC → NGN                       | Consumer approves a Spend from their Account; provider converts and pays their own or another person's bank account.                                                                   | Fonbnk first validation candidate; Breet backup; Rain a beta-access inquiry. Third-party beneficiaries must be supported explicitly.                                                                                                |
| Fiat → fiat, initially NGN → NGN | Send NGN to a Nigerian bank recipient from a supported fiat funding source.                                                                                                            | Newly explicit scope. Funding source, custody, bank collection and payout permissions, pricing, and refunds remain unresolved. No direct fiat-transfer implementation has been established.                                         |

### Fiat-to-fiat implementation choices

Distinguish the funding source before implementation:

1. Existing Xend Balance displayed in naira → Nigerian bank: this is USDC → NGN underneath and uses the off-ramp above. A naira display does not create an NGN balance.
2. NGN held with a provider when automatic conversion is off → Nigerian bank: requires that provider to support holding and transferring actual NGN, with separate reconciliation. It cannot use the current USDC-backed Balance as a substitute.
3. External Nigerian bank → another Nigerian bank: requires a collection-to-payout product. Prefer investigating an approved direct NGN path. Using NGN → USDC → NGN is a possible alternative only after explicit pricing and product review; it adds two conversions, potentially two spreads, and recovery work if collection succeeds but payout fails. Do not silently implement that round trip or imply it is atomic.

The requested fiat-to-fiat capability is recorded, but no NGN custody model or extra launch dependency is accepted by this document. Show the total source debit, recipient amount, fees, and expected arrival before approval for every supported path.

### Launch and architecture boundary

Consumer launch remains the immediate priority. Select and enable Receive and Send independently; one provider need not own both. Permanent accounts, optional conversion, and direct fiat-to-fiat each need their own capability gate and provider proof. Keep Pay With Xend compatible through the shared SpendService and separate provider operations, without implementing merchant work for this release.

Bank-payout progress must be recorded separately from the existing on-chain Spend Status. A confirmed USDC transfer must not be presented as proof that the bank recipient has been paid. The fiat Activity presentation needs a scoped specification before implementation; this research does not silently redefine CONTEXT.md.

## Provider validation recommendation

Validate Fonbnk first for consumer NGN Receive and Send. Validate Bread alongside it for permanent virtual accounts and automatic conversion. Keep Breet as a second native-Solana candidate, especially for cash-out. Do not build around Paystack unless its team explicitly accepts Xend's disclosed fiat-to-USDC use case.

Update after access probes: Bread is removed from the immediate launch shortlist due to the observed API TLS hostname mismatch and the founder's inaccessible developer dashboard. This is an operational exclusion, not a finding that all Bread services are insecure. Breet remains a backup but its API access request may delay testing. Investigate Eversend for cash-out and Esca for receiving-account capabilities while focusing on Fonbnk.

### Alternatives with faster test access

| Candidate    | Access and fit                                                                                                                                                                                                                                                    | Unresolved                                                                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eversend     | [Signup](https://business.eversend.co/signup). Official [USDC off-ramp page](https://eversend.co/platform/apis/usdc-off-ramp) advertises self-serve sandbox, Solana and NGN bank payouts.                                                                         | Live compliance review; exact enabled corridor and consumer permissions untested. Published Solana deposit charge is $1; confirm economics for small Sends.                                                                         |
| Esca         | [Sandbox registration](https://sandbox.esca.finance/register), linked by official [quickstart](https://docs.esca.finance/guide/getting-started/getting-started). [Docs](https://docs.esca.finance/) describe NGN virtual accounts, conversion and crypto payouts. | Solana USDC delivery, account TTL, sender/KYC rules and production access unverified; signup not exercised.                                                                                                                         |
| Sogo         | [Developer access](https://app.sogo.africa/profile?tab=developer). [Crypto API](https://developer.sogo.africa/products/crypto/sell) explicitly documents Solana USDC to NGN.                                                                                      | Settlement initially into Sogo balance; subsequent bank payout must be tested. Sandbox requires BVN/NIN; live Tier 3 KYC + KYB. Rate at settlement, not guaranteed quoted credit.                                                   |
| Onramp.money | [Developer signup](https://playground.onramp.money/signup/), sandbox available.                                                                                                                                                                                   | Custom API still needs team whitelisting; exact NGN/Solana-USDC pair and VA issuance unproven. [Access requirement](https://docs.onramp.money/onramp-whitelabel-unlisted/whitelabel-onramp-endpoints/transaction-integration-guide) |

Self-service sandbox access does not establish immediate production activation. No accounts created or providers contacted during this search.

No authenticated provider discovery, commercial onboarding, funded test, or production transaction was performed during this research. Public documentation establishes candidates, not Xend-specific availability. No provider was contacted. Some documentation examples are old or inconsistent; actual enabled routes, requirements, fees, and minimums must be fetched before implementation is finalized.

The user clarified that “sweep Paystack” meant research Paystack, not a provider named Swypt. “Some sub” is interpreted as Sumsub.

## Provider comparison

### Fonbnk: first launch candidate

The published asset list includes native Solana USDC for on-ramp and off-ramp, and Nigeria has bank payment channels in both directions. Confirm the exact combined corridor in live discovery rather than assuming every listed asset works with every listed country. [Coverage](https://docs.fonbnk.com/supported-countries-and-cryptocurrencies)

Its current KYC page says Nigerian on-ramps require basic verification with BVN; Nigerian off-ramps currently require no provider KYC. Rules can vary per integration and change. Read the runtime requirement for the intended order. The same page permits an agreed arrangement relying on the integrating business's own verification. That is not automatic permission to skip checks. [KYC](https://docs.fonbnk.com/kyc)

The documented funding journey can involve a matched agent and payment confirmation. It is an order-based ramp; a permanent personal virtual-account product was not established in the documentation reviewed. We must test whether the current Nigerian route is automated, accepts third-party payments, and supplies the required user experience. [How it works](https://docs.fonbnk.com/how-it-works)

A hosted flow may reduce UI work, but cash-out still needs Xend to sign from the Squads Account. Do not assume an external wallet-connect screen can sign for Xend. Choose hosted or API integration after verifying that handoff. Older widget documentation explicitly gates production partner tracking and signed URLs on partner verification. [Widget parameters](https://docs.fonbnk.com/v1.5/off-ramp/url-parameters)

### Bread: strongest virtual-account product candidate, execution unverified

Bread describes NGN virtual accounts and automatic on-ramp settlement to configured crypto wallets. Its public guide does not by itself prove the exact NGN-to-external-Solana-USDC route or account-opening requirements. [On-ramp](https://docs.bread.africa/onramp)

The off-ramp API explicitly lists `solana:usdc`. Its quickstart documents BVN, NIN, and hosted-link identity verification and linking an identity to a bank beneficiary. This supports investigation as a minimal-verification option, not a no-KYC claim. [Off-ramp API](https://docs.bread.africa/api-reference/offramp/execute-offramp), [Identity quickstart](https://docs.bread.africa/quickstart)

Ask for a working NGN virtual-account creation request, exact requirements, supported settlement asset and external destination, manual-versus-automatic conversion controls, third-party sender policy, business approval, fees, and a funded proof. Do not infer consumer-vault delivery from support for the provider's own Solana wallets.

### Breet: native-Solana backup, consumer receipt model needs confirmation

Breet documents Solana USDC deposits and external withdrawals, plus NGN bank payouts. The published deposit minimum for Solana USDC is $15, with smaller deposits flagged; fetch the live minimum. This matters for everyday small Sends. [Supported assets](https://docs.breet.io/supported-assets)

The API has a business balance and crypto conversion/payout model. The public API index describes NGN-to-USD conversion with optional stablecoin withdrawal, but does not establish per-Consumer NGN virtual-account issuance. [API index](https://docs.breet.io/llms.txt)

Its FAQ requires business incorporation records, address evidence, and directors' KYC. It does not clearly specify the verification required of every end Consumer for Xend's use case. Absence of a customer KYC field is not evidence of a no-KYC arrangement. [FAQ](https://docs.breet.io/faqs)

### Paystack: appropriate primitives, material eligibility and conversion gaps

Pay with Transfer provides temporary bank accounts tied to individual payments. The documented expiry range is 15 minutes to eight hours. The charge request includes email and amount, so the collection form can be short. These endpoints are for an approved business's payment collection; a short request body does not establish approval for a stablecoin funding product. [Payment channels](https://paystack.com/docs/payments/payment-channels/)

Permanent Dedicated Virtual Accounts are available after business go-live. Financial-services businesses must validate customers before issuance; the documented flow includes BVN and bank-account details, and requires customer consent. [DVA guide](https://paystack.com/docs/payments/dedicated-virtual-accounts/)

Paystack's Nigeria unsupported categories include cryptocurrency trading and forex/currency exchange. Xend should disclose the actual NGN-to-USDC flow and obtain a clear eligibility answer before investing in this route. Do not relabel it as ordinary retail collection. [Ineligible businesses](https://support.paystack.com/en/articles/2127042)

Paystack collection is not a Solana-USDC delivery mechanism. Pairing it with a conversion provider adds collection settlement, liquidity, beneficiary approval, and cross-provider reconciliation. No evidence establishes that combination as a faster three-day route than a ramp provider. Temporary accounts alone do not solve these gaps.

### MoonPay and global ramp follow-up

MoonPay currently lists Nigeria among unsupported jurisdictions. Its Nigeria announcement discontinued buying, selling, and swapping in June 2024; the current help page still confirms the restriction. A separate currency list includes NGN, but that does not establish service availability to Nigerian residents. Exclude the standard MoonPay consumer ramp from the launch shortlist. [Current country restrictions](https://support.moonpay.com/en/articles/380968-moonpay-s-unsupported-countries), [Nigeria announcement](https://www.moonpay.com/en-gb/newsroom/nigeria), [Currency list](https://support.moonpay.com/en/articles/362475-moonpay-s-supported-currencies)

Onramp.money documents NGN in its fiat configuration and a Solana/SPL network identifier, but the reviewed transaction examples do not establish the combined NGN-to-native-Solana-USDC route. Its Nigerian verification flow can return a hosted KYC link. Keep it as an inquiry candidate, not a verified no-KYC alternative. [Configuration](https://docs.onramp.money/onramp-whitelabel-unlisted/coin-network-and-fiat-configuration/all-config-mapping), [KYC requirements](https://docs.onramp.money/onramp-whitelabel-unlisted/whitelabel-kyc-data-submission-endpoints/kyc-requirements)

Transak documents Solana USDC in its crypto API. Nigeria local-bank collection was not established in this follow-up; its linked global-coverage page returned HTTP 403. Do not infer an available corridor from independent country, currency, and token listings. [Crypto API](https://docs.transak.com/api/public/get-crypto-currencies), [Coverage entry point](https://support.transak.com/en/articles/7846056-countries-and-crypto-supported-by-transak)

Preferred launch composition is direct NGN collection by the selected ramp provider, conversion, and native USDC delivery to the Consumer's Squads vault. A separate fiat collector remains possible only if both providers accept the disclosed flow and the conversion provider supports the resulting source of funds. A retail customer ramp must not be assumed to accept pooled business collections. This separation adds settlement timing and reconciliation work; it is not the default three-day plan.

### Rain: payout expansion, not yet a launch dependency

Rain announced stablecoin-funded payouts across 80+ countries and 50 currencies on September 8, 2026. It supports own-account and third-party flows, including C2C and C2B. Access is currently selected-partner beta; broader availability is expected by year-end. Arrival varies from real time to two business days. The release does not establish NGN collection, temporary accounts, or no-KYC eligibility. [Rain-issued announcement](https://www.prnewswire.com/news-releases/rain-expands-global-payouts-to-more-than-80-countries-in-50-currencies-302871735.html)

Rain advertises major stablecoins and Solana for money movement, but exact NGN corridor support remains unverified. [Money-out](https://www.rain.xyz/money-out)

Proposed role: Consumer bank Sends now if access and the exact route are proven; potentially Merchant Payouts later. Confirm Nigerian Consumer eligibility, native USDC funding from Squads, beneficiary rules, KYC/Sumsub reliance, quote/fee/return behavior, and activation timeline. Do not make the consumer release depend on beta access. It does not replace Xend Checkout, merchant payment confirmation, or refund orchestration.

### Other candidates screened

| Provider    | Finding                                                                                                                                      | Disposition for this release                                                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Onboard     | Explicit limited no-KYC trade support, but its published network page lists EVM networks rather than Solana and contains dated roadmap text. | Interesting low-friction model; native Solana remains unverified. [Connect](https://docs.onboard.xyz/onboard-exchange/connect/overview), [Networks](https://docs.onboard.xyz/onboard-exchange/supported-networks-tokens) |
| Paycrest    | NGN and bidirectional ramps are documented; published networks are EVM, with KYC/KYB at participating entities.                              | Does not establish a native-Solana alternative. [Introduction](https://docs.paycrest.io/introduction)                                                                                                                    |
| Yellow Card | Published Nigerian payment/collection metadata requires both NIN and BVN and partner customer screening.                                     | Full-verification candidate rather than the lowest-friction launch option; Solana route not established in this sweep. [KYC metadata](https://docs.yellowcard.engineering/v1.0.24/docs/kyc-metadata)                     |
| Quidax      | Published USDC receive/send networks list BEP20, ERC20, TRC20, not Solana.                                                                   | Do not infer USDC-on-Solana from support for SOL trading. [Assets](https://docs.quidax.io/docs/supported-cryptocurrencies)                                                                                               |
| Blockradar  | One-time accounts exist, but published NGN conversion matrix omits Solana. Founder is awaiting CEO response.                                 | Keep the existing adapter disabled; do not plan on an uncommitted provider roadmap. [Fiat matrix](https://docs.blockradar.co/en/use-cases/supported-fiat-currencies)                                                     |

This is a targeted sweep of plausible consumer NGN rails, not an exhaustive or commercial endorsement of every provider in the market.

## Consumer flow proposal

Keep Receive and Send with their Fiat and Crypto choices. Selecting Fiat opens the taller sheet requested by the user. The backend provides eligible routes and requirements for the Consumer, direction, currency, and amount.

Suggested Receive sequence:

1. Select NGN and enter the amount or desired Balance credit.
2. Fetch a current quote and verification requirements.
3. If the provider permits the order without further verification, continue. Otherwise collect only its required fields or open the verification flow.
4. Show amount to send, fees, expected credit, account details, expiry, and sender restrictions. Use provider expiry, not an invented local timer.
5. Track receipt and conversion independently. Credit the spendable Balance only when USDC reaches the Consumer's Squads vault on-chain.
6. Record late, mismatched, duplicate, failed, or returned payments as actionable states. A bank-transfer screenshot or browser callback is not receipt confirmation.

Do not lead with “KYC incomplete” when the requested action is available. Prefer a neutral explanation of an available one-time receipt or the verification necessary for that action. Do not advertise “no KYC” universally.

Suggested Send sequence: destination bank and account, resolved beneficiary name, amount and quote, required verification, explicit approval through SpendService, transfer to the pinned provider destination, bank payout tracking. A confirmed USDC debit and completed bank payout are different milestones. Never retry an ambiguous payout by initiating a second debit.

Verification and risk eligibility should be direction-specific. A Consumer eligible to cash out is not automatically eligible for a permanent receiving account. A completed full-KYC flow does not automatically raise the Account's on-chain signature ceiling.

## Permanent virtual accounts and automatic conversion

Proposed setting: Settings → Bank accounts → Automatically convert incoming naira.

The user explicitly wants this option. Its semantics must be real:

- On: new eligible NGN receipts convert at the disclosed execution rate and fees, then deliver USDC to the Account automatically.
- Off: receipts remain with a provider that supports a separately recorded NGN balance or pending conversion, and the Consumer approves conversion. If the provider cannot hold NGN, use one-time pre-approved funding orders until a permanent-account provider with suitable controls is available. Do not simulate a fiat balance in Xend or silently continue converting.
- A preference change affects future uncommitted conversions; it does not retroactively cancel a provider operation already underway. Clearly report conversions in flight.
- Capture explicit consent, fee/rate policy, destination vault, and preference version. Apply a bounded quote or rate-protection policy; re-prompt rather than silently accepting materially changed terms.
- This is conversion of incoming bank receipts. It is not permission to debit an unrelated external bank account, and does not move existing Cash out of the vault.

The current Account has one USDC-backed Balance. Holding unconverted naira introduces a separate provider-held amount that must be displayed and reconciled distinctly. It cannot be added to spendable Cash before conversion. This is a substantive extension of CONTEXT.md, not merely a settings switch.

Full KYC can gate permanent account eligibility, but the bank/ramp provider still must approve issuance. A Sumsub pass alone does not create a virtual account.

## Sumsub implementation proposal

The backend currently has KycProvider and SumsubAdapter, but the adapter methods throw and KycModule exposes no controller/service workflow. Old device-local KYC helper references are not a current verification source of truth.

For the deadline, use a backend-created applicant-specific hosted verification link, opened from the app, rather than adding a native camera SDK before proving it is needed. Sumsub supports links with applicant identity, verification level, expiry, and return URLs. [External WebSDK link](https://docs.sumsub.com/reference/generate-websdk-external-link)

Implement authenticated start/status endpoints, durable applicant-to-Consumer linkage and verification level/status, and a webhook receiver. Verify the raw-body HMAC using the configured supported digest algorithm, persist idempotently, and refresh authoritative status on return. Never grant approval from the redirect query string. [Webhook verification](https://docs.sumsub.com/docs/webhook-manager)

Configure the full-verification level with the selected financial partner's actual requirements. Keep provider approval/eligibility separate from Xend's verification status. Reusing Sumsub results across companies requires the receiving partner's participation and acceptance; the documented partner-sharing mechanism is not a universal passport. [Partner management](https://docs.sumsub.com/docs/manage-sharing-partners)

If basic ramp verification already completes an eligible Receive or Send, full Sumsub verification need not block that action. It becomes the upgrade path for capabilities that require it.

## Three-day execution proposal

This schedule assumes live provider access and an enabled NGN/Solana-USDC route can be obtained promptly. It is not a promise of approval within three days.

Day 1: select the provider using real account discovery, confirm production access and customer requirements, and prove both directions at a permitted test amount. Freeze the quote/order/webhook contracts. Implement durable ramp orders behind an owned provider interface and the minimum verification path. Begin the Sumsub hosted workflow independently if credentials and level are ready.

Day 2: wire the Receive and Send sheets to real orders, Account destination and Spend authorization; add status polling/reconciliation and honest Activity states. Add permanent accounts and the automatic-conversion setting only if the provider demonstrates both account issuance and the off-state behavior. Otherwise continue that capability behind a feature gate while one-time funding works.

Day 3: test the complete app flow, including expiry, wrong amount, third-party sender rules, restart, duplicate webhook, payout timeout, refund/return, and a real vault credit/debit. Keep successful USDC debit separate from bank-payout completion. Launch only the proven direction/capability if provider access is partial.

No merchant onboarding, merchant API, or merchant settlement work belongs on this consumer release's critical path. Reuse the Account, SpendService, provider isolation, money precision, and reconciliation architecture so next week's Pay With Xend work remains compatible.

## Provider questions, ready to send by the founder

We are launching a Nigerian consumer payments app using self-custodial Squads Accounts holding native USDC on Solana. We need NGN bank receipts converted and delivered to each external Account, and USDC sent from those Accounts paid out to Nigerian banks. We also want permanent NGN virtual accounts with optional automatic conversion.

Please confirm:

1. Are both exact routes live for our integration, without Xend operating a cross-chain bridge? Can we obtain live access within our release window?
2. What identity fields, verification, limits, and consent apply separately to one-time receipts, permanent accounts, and payouts? Are third-party senders and third-party payout beneficiaries permitted?
3. Can USDC settle to an external Solana PDA-owned token account? Are provider deposit addresses required as an intermediate step?
4. Can permanent accounts hold NGN when automatic conversion is disabled, and what are the custody, fee, and return arrangements?
5. What happens to late transfers, wrong amounts, payout failures, and ambiguous API timeouts? Which identifiers make requests and retries idempotent?
6. What are the current minimums, spreads, fees, quote validity, settlement times, and API/webhook access conditions?
7. Can you accept our Sumsub verification, and what additional BVN or partner-specific checks remain?

For Paystack, first ask whether this disclosed stablecoin funding model is eligible under its Nigeria policy. Do not start by assuming it is an ordinary payment-collection integration.
