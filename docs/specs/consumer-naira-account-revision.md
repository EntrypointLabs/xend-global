# Consumer naira accounts: revised provider and code architecture proposal

Date: 2026-09-08. Research checked against public primary sources. This supersedes earlier temporary-account launch prioritisation. Temporary accounts are parked at the founder's request. Provider selection, fiat custody and cross-chain implementation remain unproven proposals; no production capability is enabled by this document.

Latest evidence: [credential-free probes](public-fiat-sandbox-probes.md) found Paga's subsidiary-account API, strengthening its fit for NGN holding. Nomba's public sandbox is callable but shows fixture-style persistence and retry behaviour. This updates the evidence gaps below; no provider is production-enabled.

## Product direction

Offer a distinct NGN balance with reusable receiving details, progressive verification and direct NGN bank transfers. Keep native Solana USDC in the existing Consumer Squads Account. Explore Bridge for USD receiving and USD payouts. USD bank receiving details do not by themselves establish a held fiat USD balance. Consumer launch remains first; preserve future Pay With Xend compatibility without adding merchant launch work.

Every eligible user should be able to activate a naira account, but account issuance must follow partner verification and approval. Creating an app profile is separate from opening a regulated fiat account.

## KYC comparison

There is no evidenced no-KYC personal NGN account among these providers. The [CBN December 2023 circular](https://www.cbn.gov.ng/Out/2023/PSMD/Circular%20on%20Tier%201%20Wallets%20%26%20Accounts%2C%20Guidance%20Note%20%26%20Profiling%20of%20Customers%27%20Accounts%20%26%20Wallets.pdf) requires electronically validated BVN or NIN for Tier 1, and both for Tiers 2 and 3. Old phone-only descriptions and optional API fields do not override the account-opening requirements.

| Candidate | Published customer requirements / evidence | Interpretation for Xend |
| --- | --- | --- |
| Paga | Consumer wallet tiers exist. Persistent collection API lists BVN as optional. | First product-fit inquiry, but embedded consumer wallet onboarding and exact KYC cannot be ranked as easier than Flutterwave without Paga's current partner requirements. Optional BVN is not evidence of no-KYC fiat holding. |
| Flutterwave | Static NGN virtual-account guide requires NIN or BVN plus customer details. | Lowest clearly documented identity requirement of the compared static-account APIs; still a collection product, not proof of per-user custody. |
| Paystack | Financial-services DVA validation requires BVN and an existing bank account linked to it. | More customer friction than Flutterwave's documented NIN/BVN route. Crypto/FX use-case eligibility is a separate blocker. |

Sources: [Paga persistent accounts](https://developer-docs.paga.com/v1.2/docs/persistent-wallet-account), [Flutterwave NGN accounts](https://developer.flutterwave.com/v3.0/docs/ngn-virtual-accounts), [Paystack validation](https://paystack.com/docs/identity-verification/validate-customer/).

Practical investigation order is Paga first, Flutterwave conditional second, Paystack conditional third. This is a product-fit priority, not a proven three-way minimal-KYC ranking. Paga's retail wallet and its merchant collection API are distinct products: confirm which contract actually gives Xend end-user fiat holding, limits and payouts.

### Published Paga retail tiers, not approved Xend limits

| Tier | Daily transaction limit | Balance limit |
| --- | --- | --- |
| KYC 1 | NGN 50,000 | NGN 300,000 |
| KYC 2 | NGN 200,000 | NGN 500,000 |
| KYC 3 | NGN 5,000,000 | Unlimited as published |

[Paga support](https://mypaga.freshdesk.com/support/solutions/articles/35000067842-what-is-kyc-) publishes these values and an upgrade flow with selfie, valid ID and proof of address. Its older terms contain conflicting historical limits, so partner confirmation is required before displaying these as Xend allowances. Daily transaction limit is not a separately verified daily incoming-transfer allowance; neither per-transfer receipt limits nor overflow handling are established here. Do not translate “unlimited balance” into unlimited sends. Flutterwave and Paystack do not establish comparable consumer wallet tiers in the cited collection documentation.

Proposed UX: unverified app profile -> basic verified NGN account -> enhanced verification with partner-approved higher limits. Display receive, per-transfer send, daily send, balance and remaining allowances separately. Provider/customer/route restrictions remain authoritative. Full KYC must not override the existing Account signing policy or ADR 0032 ceiling.

### Business eligibility

[Paystack's Nigeria list](https://support.paystack.com/en/articles/2127042) excludes cryptocurrency trading, FX/currency exchange and IMTOs. [Flutterwave's help policy](https://www.flutterwave.com/us/support/my-account/businesses-and-services-prohibited-by-flutterwave) lists digital wallets, cryptocurrency and currency-exchange services as prohibited. A separate enterprise agreement may differ, but neither is an ordinary self-serve approved Xend rail based on these pages. Disclose the complete wallet/conversion use case and obtain an applicable agreement before relying on either. Sending collected NGN to another crypto provider does not establish eligibility.

## Paga, USDsui and Solana

[Sui's May 7 announcement](https://www.sui.io/blog/shaping-the-way-money-moves-across-continents-with-sui-and-paga) confirms integration of USDsui across Paga's enterprise APIs and consumer app. [Paga's May 13 explanation](https://paga.blog/2026/05/13/what-is-sui-everything-you-need-to-know-about-the-partnership-with-paga/) describes future user access. These establish the partnership, not authenticated NGN conversion endpoints, liquidity, redemption, external withdrawals or Xend access.

A newer [Paga–Crossmint announcement, June 10](https://paga.blog/2026/06/10/paga-and-crossmint-partner-to-bring-multi-chain-stablecoin-infrastructure-to-africa/) describes fiat on/off ramps and multi-chain infrastructure including Solana. First investigate direct NGN <-> native Solana USDC through this offering. Broad chain support is not proof of the exact route, supported beneficiaries or external Squads-vault settlement.

USDsui and USDC are different assets. A possible indirect route is NGN -> USDsui on Sui -> native USDC on Sui -> native USDC on Solana. The middle step needs an executable exchange/redemption quote and liquidity; bridging alone does not convert the asset. [Circle's current CCTP domain documentation](https://developers.circle.com/cctp/concepts/supported-chains-and-domains) lists Sui under legacy V1: do not assume a V2-only integration supports this route. Protocol support does not prove a funded end-to-end Paga route. The reverse route needs independent proof.

Prefer a provider responsible for delivery of native USDC to the destination vault. Xend-operated Sui custody, swaps and bridge recovery would be a material expansion of the existing architecture and must be specified before implementation.

## Corrected funds flows

- NGN receive: incoming bank transfer -> partner-held NGN -> reconciled NGN balance.
- NGN bank send: reserved NGN balance -> partner bank payout -> confirmed bank delivery. No stablecoin round trip required.
- NGN to USDC: reserved NGN -> executable conversion route -> native USDC delivered to the Consumer's Squads vault -> chain-confirmed USDC balance.
- USDC to NGN: existing authorised Spend -> selected ramp -> NGN bank payout. Blockchain confirmation and bank delivery are separate events.
- International send: selected NGN/USDC source -> available quoted route -> supported destination fiat and beneficiary. Never infer worldwide payout support from stablecoin support.
- Automatic conversion off: retain actual partner-held NGN. On: use an authorised conversion policy after settled eligible deposits. Preserve failed conversion amounts as NGN/pending conversion, never fabricate USDC credit. Specify price/slippage limits, quote expiry and retry rules before enabling.

cNGN is an optional intermediary if a proven provider needs it, not a requirement imposed by using Paystack or Flutterwave. Collection, conversion and payout are independent capabilities. A direct NGN-to-Solana-USDC provider is preferable when its access, pricing and recovery behaviour are proven.

## Bridge and USD

[Bridge virtual accounts](https://apidocs.bridge.xyz/platform/orchestration/virtual_accounts/virtual-account) provide reusable fiat receiving details and automatically convert to a configured crypto destination. A USD receiving account settling to USDC is therefore not a second held USD fiat balance. [External accounts](https://apidocs.bridge.xyz/platform/orchestration/external-accounts/external-accounts-api) represent linked payout bank accounts.

Treat Bridge as a USD rail/conversion adapter, not automatically the custodian replacing the existing USDC vault. Separate source currency, settlement asset/network, destination currency and custody. Nigerian resident eligibility, customer endorsement, third-party deposits/payouts, enabled USD rails and exact Solana settlement must be verified with the actual Bridge account. A USD payout means the recipient receives USD; it does not require Xend to hold USD fiat. If actual USD holding is intended, it needs its own supported custody product and reconciliation model.

## Proposed code boundaries (not implemented by this revision)

Retain the existing provider-neutral quotes/orders/events, ownership checks, idempotency and adapter registry. Split capabilities rather than adding a mandatory multi-function provider:

- FiatAccountProvider: customer onboarding requirements, reusable account issuance, account status, supported custody model.
- FiatBalanceProvider: settled/pending partner balances and statements for reconciliation.
- ConversionProvider: firm quote, source debit, destination credit, execution and recovery.
- FiatPayoutProvider: beneficiary validation, bank send and delivery status.
- EligibilityService: customer/provider/operation-specific verification and limits, with source and effective date.
- ConversionPolicyService: explicit auto-conversion consent and policy versions.

Add distinct provider customer/account records, fiat ledger entries with atomic reservations, durable payout/conversion legs, webhook inbox deduplication, and reconciliation jobs. Never treat a collection notification or provider aggregate balance as proof of an individual customer's spendable fiat. Record the custody backing and account owner. NGN, USD fiat and USDC must not be summed as equivalent amounts without display-only FX conversion.

Keep provider choice pinned to issued accounts and in-flight operations. Changing the default adapter routes new business; it cannot silently migrate existing bank details, balances or pending payouts. This is the practical limit of the “swap provider in a day” objective.

Pay With Xend can later consume the same conversion and payout capabilities. Preserve chain-confirmed USDC spending and quote validity; a pending fiat deposit is never already-spendable USDC for checkout. Merchant features remain out of this consumer release.

## Evidence needed next

Use [Paga developer onboarding](https://developer-docs.paga.com/docs/create-an-account) for sandbox registration. Establish embedded consumer wallets versus collection accounts, exact tier requirements and receipt limits, third-party funding, direct bank payouts, NGN <-> native Solana USDC, external vault destination, fees, and failure/return handling. No Paga, Flutterwave, Paystack or Bridge transaction was executed in this research pass. Prior Fonbnk sandbox quotes remain evidence only for that separate adapter.
