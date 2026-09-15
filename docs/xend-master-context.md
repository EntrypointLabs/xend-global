# Xend: Master Context

**Purpose.** This is the single briefing document for anyone (human or agent) building outward-facing material about Xend: the marketing website, the merchant landing page, the developer docs shell, App Store copy, a pitch deck, a press note.

It answers, in order: what Xend is, how it is allowed to sound, what actually ships today, how the Account is secured, what Pay with Xend is and why it is positioned as the Apple Pay of crypto-settled commerce, every consequential decision that got us here, what is coming next, and what is not true yet.

**Status of this document.** Written 2026-08-29 from the shipped codebase, the architecture decision records, the domain glossary, the platform handoffs, and the brand kit. Where a claim is aspirational rather than shipped, it is marked. Section 9 is the honesty ledger and it is not optional reading: a marketing site that overclaims here is a compliance and trust problem, not a copy problem.

---

## 1. What Xend is

### The one-liner

Xend is a mobile money app for everyday people. You hold dollars, you send them to anyone in seconds, and you pay online merchants with your face or fingerprint.

The public brand phrase is **"Money, but faster."**

The current site strapline is: _"A checking account for the internet, built for everyday life."_

### The longer version

Xend is a consumer payments product built for African markets, Nigeria first. A person signs up with a passkey, holds a dollar balance, sends money to friends, and pays merchants online with a single biometric confirmation. Settlement runs on Solana in USDC, the account is a Squads smart account with a 2-of-3 signer set, network fees are sponsored by Xend, and none of that is ever spoken aloud to the person using it.

There are two halves to the business, and it matters which one is the point:

1. **The consumer app** is the proof of concept. It proves the account model works, that a non-crypto person can hold and move dollars without a seed phrase, and that recovery is survivable.
2. **Pay with Xend** is the actual business. It is a checkout button any online store drops next to card and Apple Pay, plus the SDK and merchant API behind it. Every button placed is distribution that compounds. Every payment writes history that later underwrites credit.

Internally this is called the AfroPay thesis: the visible wallet app is the demo, the embedded checkout is the company.

### Who it is for

**Consumers.** Everyday people, not crypto-native. Nigeria first. The mental model the product serves is "spending money," never "moving tokens." They shop on local and international web merchants and they hold dollars because their local currency does not hold value well.

**Merchants.** Businesses with an online checkout. Hand-picked at pilot; at scale, anyone who can drop a script tag and handle a webhook. They want settlement in seconds instead of T+2, no card-network chargeback exposure, fees that undercut card acquiring, and access to a dollar-holding customer base that cards underserve. They can take settlement in naira straight to their bank, or hold digital dollars.

**Developers.** The integration is a script tag or an npm package, a server-side intent creation call, and a signed webhook. If it feels harder than Stripe, we have failed.

### Why it exists

Moving a dollar between two ordinary people is still slow, expensive, and gated. Card acquiring in the launch market is expensive and settlement is slow. Meanwhile the tooling that could fix it, stablecoins on a fast chain, is wrapped in vocabulary and key management that no ordinary person will ever accept. Xend's whole bet is that the rails are ready and the interface is the missing product.

---

## 2. Positioning and voice: how Xend is allowed to sound

This is the section most likely to be skimmed and most likely to cause damage if it is. Read it fully.

### 2.1 The register is fintech. Never crypto.

Xend's public register is fintech. Solana, USDC, wallets, gas, chains, seed phrases, on-chain, tokens: these are implementation details. They appear in engineering documents. They appear nowhere a consumer or an ordinary merchant operator will read.

**If the words "wallet", "gas", "on-chain", or "seed phrase" appear on a consumer-facing or merchant-facing surface, that is a defect, not a stylistic choice.**

The comparables to write against are Apple Pay, Shop Pay, Stripe Link, PayPal, Cash App, Wise, Paystack. Not MetaMask, not Phantom, not a DeFi dashboard.

### 2.2 What we are explicitly not

State these in the negative when the site needs to differentiate, because the category is crowded with things Xend is not:

- **Not another crypto neobank.** The site should not read like a neobank pitch with a chain logo bolted on. Xend does not lead with yield, does not lead with tokens, does not lead with a treasury story.
- **Not a wallet.** The word is banned outright, in copy and in code. The thing a person has is an **Account**. There is no wallet metaphor in the copy and no wallet, billfold, or purse imagery in the design.
- **Not a crypto product with a consumer skin.** The chain is invisible by design, not by omission. If a visitor leaves the site knowing which chain we use, the site is mis-tuned.
- **Not a trading app.** No charts of token prices as a hero. No "portfolio performance" framing as the lead. Investments exist in the app as a read of what someone already holds, not as a product surface we push.
- **Not custodial, and not making a self-custody purity argument either.** The security story is told in plain terms (see section 5), not in ideology.
- **Not multi-chain, not cross-chain.** Solana only. Cross-chain tooling was deliberately removed from the stack and must not return through marketing copy.
- **Not asking shoppers for KYC at checkout.** Ever. Compliance attaches at the fiat boundary and to the merchant, never to a shopper inside a checkout popup.

### 2.3 Tone

- **Plain, declarative, unhurried.** Short sentences. Concrete nouns. Active voice.
- **Headlines are claims, not labels.** "Money, but faster" beats "Our Product". "Moving a dollar is stuck in 2005" beats "The Problem".
- **One idea per section.** If a section needs two messages, split it or cut the weaker one.
- **Honesty reads as confidence; hype reads as risk.** Pilots are described as pilots. Things that are coming are labelled as coming. Never present a preview surface as live.
- **Never invent a metric.** If there is no traction number, show momentum honestly (private beta, invite-only, mainnet-ready) or cut the section.
- **No em dashes.** Anywhere. Not in UI copy, not in site copy, not in docs.
- **No filler.** "Seamlessly", "finally", "revolutionary", "empowering", "the future of". Cut on sight.
- **No emoji as section markers.**
- **Body text never below 12px.**

### 2.4 The vocabulary is binding

This glossary is canonical. Using the wrong word is the fastest way to look off-brand, and several of these are load-bearing legally as well as tonally.

| Say this                      | Never say                                    | What it means                                                                             |
| ----------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Xend**                      | the app, the wallet                          | The product. Proper noun, always capitalised.                                             |
| **Consumer**                  | user, customer, trader, holder               | An everyday person using Xend.                                                            |
| **Account**                   | wallet, smart wallet, smart account, profile | The Consumer's account on Solana. Exactly one per Consumer. Holds their Cash.             |
| **Passkey**                   | key, credential, login, device key           | The platform-keychain auth primitive. Synced across a person's devices, not device-bound. |
| **Cash**                      | wallet, funds, holdings, tokens              | The feature area covering everything about the Consumer's money.                          |
| **Balance**                   | amount, funds                                | The number on the Cash surface. Shown in the Consumer's own currency.                     |
| **Spend**                     | transact                                     | The umbrella concept for any outflow, P2P or merchant. The headline marketing verb.       |
| **Send**                      | transfer, push                               | The in-app action verb for a P2P Spend. The button label.                                 |
| **Sending**                   | processing, submitting, in progress          | What a Consumer sees while a Spend is in flight.                                          |
| **Receive**                   | top up, deposit, fund, add cash              | Any inflow, from any source. One word covers all of them.                                 |
| **Activity** / **Activities** | transaction, history, ledger, feed           | A single event in the Account timeline, and the reverse-chronological list of them.       |
| **Contact**                   | recipient, payee                             | A saved destination plus a label. A personal shortcut, not a social graph.                |
| **Spending Limit**            | budget, cap, allowance                       | A self-imposed cap on outflow per period.                                                 |
| **Recover**                   | restore, reset, sign back in                 | Regaining access to an Account on a new device.                                           |
| **Recovery Email**            | backup email, secondary email                | An email attached to the Account that backs a recovery signer.                            |
| **Merchant**                  | vendor, store, business, seller              | An online store that accepts Payments through Checkout.                                   |
| **Payment**                   | transaction, charge, order, purchase         | A Consumer paying a Merchant. A Spend whose counterparty is a Merchant.                   |
| **Checkout**                  | payment page, widget, popup, iframe          | The Xend-hosted surface where a Payment is approved.                                      |
| **Session**                   | token, login, remember-me                    | Merchant-scoped recognition that lets repeat Payments skip the passkey ceremony.          |
| **Payout**                    | withdrawal, off-ramp, settlement             | Movement of settled Payment funds to the Merchant's bank in local currency.               |

**Spend vs Send vs Payment**, since this trips everyone: **Spend** is the umbrella concept and the marketing verb. **Send** is the in-app button for the peer-to-peer case. A **Payment** is a Spend where the counterparty is a Merchant. Every Payment is a Spend. Not every Spend is a Payment.

### 2.5 The visual system

Xend is **strictly monochrome**. There is no brand colour. This is deliberate and it is a strength: it is rare, it is cheap to hold consistent, and it removes the most common way a generated asset library drifts.

**Palette, and this is the whole palette:**

| Token        | Hex                              | Role                                                                    |
| ------------ | -------------------------------- | ----------------------------------------------------------------------- |
| `INK`        | `#0A0A0A`                        | Text on light, background on dark                                       |
| `PAPER`      | `#F5F5F5`                        | Canvas                                                                  |
| `WHITE`      | `#FFFFFF`                        | Cards                                                                   |
| `MUTED`      | `#6B6B6B`                        | Secondary text on light                                                 |
| `MUTED-DARK` | `#9BA1A6`                        | Secondary text on dark                                                  |
| `DIM`        | `#9A9A9A`                        | Tertiary text (derived, not a brand colour)                             |
| `BORDER`     | `#CCCCCC` light / `#333333` dark | Hairlines                                                               |
| `ERROR`      | `#FF3B30`                        | **Input validation only.** Never a surface fill, never a status colour. |

Red is allowed as a small icon glyph or a line of warning text. It is never a background. Nothing in the product uses a coloured surface fill, so nothing on the site should either.

**Emphasis comes from form, never hue.** Weight, tone, inversion (black on white versus white on black), filled versus hollow, solid versus outline.

**Type.** Geist and Geist Mono. Geist Pixel exists for label-scale texture. Geist has no italic; never fake one. Money uses tabular numerals.

**The mark** is a four-point X with concave blades, sharp tips at the diagonals, narrowing to a waist at the centre. It has a canonical vector path. It is never redrawn by eye. The starburst motif that predates it is retired.

**A Balance is the largest type in any frame that shows one.** It renders at 56px in the app and 65px on the Send screen. Marketing frames must respect that hierarchy.

**Photography carries all the colour.** The interface stays monochrome; every warm or coloured pixel on a page lives inside a photograph. Photographs are cold, flat, desaturated, overcast. No golden hour, no saturation push, no lens flare, no duotone.

Two photographic registers, and only two:

- **Consumer, macro.** Hands and everyday objects. A phone on a counter, a market exchange, a receipt, a door key. Human scale, close in. Used for consumer marketing, P2P, app store, social.
- **Merchant, systemic.** Aerial and infrastructural. Roads, bridges, ports, interchanges. Wide, ordered, from above. Used for merchant acquisition, Checkout, Payout, developer and partner surfaces.

Register follows audience, never aesthetics. Never both registers in one frame or one campaign beat.

**Visual bans, learned the hard way:**

- No coins, tokens, ingots, chains, or circuit-board patterns. The rails are invisible to the Consumer; the assets must not reintroduce them.
- No Solana, USDC, or third-party logos.
- No wallet, billfold, or purse forms.
- No titanium, carbon fibre, chrome, or neon rim lighting. That is the dark crypto-premium register and it directly contradicts "everyday consumer, not crypto-native."
- No gradients as decoration, no holographic or iridescent finishes, no bokeh, no lens flare.
- No sharp unfilleted corners. Sharp corners read as hard and industrial and break the consumer register on sight.
- Nothing that reads as a generic AI render.

---

## 3. What ships today: the consumer app

Expo React Native, Android and iOS, currently in pre-launch. The following is what a Consumer can actually do.

### 3.1 Getting an Account

**Email first, then a passkey.** The front door asks for an address and a six-digit code (ADR 0027). A new Consumer then creates a passkey and the phone enrols its hardware key; a returning Consumer is offered their passkey. There is no password and no seed phrase at any point.

**The email is a contact detail, not a credential.** The third signer on the Account is anchored to that verified address, so it is not skippable: an Account without it would have no recovery path at all. On an existing Account an emailed code opens only a limited entry session, which can read and can start a recovery and can neither Spend nor change the signer set (ADR 0028).

**Then the Account is created in its final shape:** three signers, two policies, a 24-hour lock on settings changes. If a signup is interrupted, the Consumer resumes where they left off rather than landing on an empty dashboard, because the resume point is derived from what is actually on file.

An Account costs 0.00252452 SOL to create, almost entirely rent, with no protocol creation fee. The Consumer pays none of it and never sees it.

### 3.2 Cash: holding and moving money

- **A dollar Balance**, displayed in the Consumer's own currency, backed 1:1 by USDC on Solana.
- **Send** to a Solana address, to a `.sol` name resolved at send time, or to a saved Contact. Amount entry in either dollars or the token figure.
- **Receive** covers every inflow under one word: from another Consumer, from an external address, from an on-ramp. QR code and address sharing.
- **Balance is never optimistic.** It updates only when the change actually confirms on chain. While a Spend is in flight the Activity appears as "Sending" with a spinner and the Balance has not moved. This is a deliberate trade of perceived speed for accuracy and trust, and it is the opposite of what most consumer payment apps do.
- **Spend Status has three values** and no chain nuance: Pending (shown as Sending), Sent, Failed.
- **Network fees are sponsored.** A relayer co-signs as fee payer, so a Consumer never needs to hold SOL and never sees a gas concept.

### 3.3 Activity

One reverse-chronological feed per Account covering everything: Spends, Receives, Payments to merchants (rendered with the merchant name), and non-money events such as adding a recovery key or a settings change reaching the chain. Merchant Payments are debits rendered without an address.

### 3.4 Contacts and limits

- **Address book.** A saved destination plus a label. A personal shortcut, not a directory or a social graph.
- **Spending Limits.** Every Account is provisioned with one daily limit, US $100, chosen to sit under the Nigerian OTP-tier ceiling (ADR 0032). Under it a Spend takes one signature; above it the phone's key signs as well. The limit can be raised, lowered or removed from Settings. Changing it is a settings change like a signer change: both on-device keys approve it, it waits out the 24-hour lock, and the Consumer is told when it is staged and when it lands. Removing it leaves a stricter Account, not a looser one, because every Spend then takes two signatures.

### 3.5 Investments and Swap

- **Investments** is a read of every token the Consumer holds that is not their spending balance. Nothing to opt into; it is a view of what they already own.
- **Swap** between held assets, quoted and executed in-app. The receive side stays blank until a real quote arrives, because showing a converted figure without a real rate would invent a price someone might act on.

### 3.6 Earn

A yield position on the spending balance, with the position, the rate on offer, and lifetime earned. Deposits are not wired yet, so the screen shows an honest zero position and the products actually on offer rather than a "coming soon" wall. The rate is the provider's quoted figure rather than a live read, and the home tile derives its headline from that same figure so the two cannot disagree. See section 9.

### 3.7 Security and recovery surfaces

Under Settings, Security:

- **Keys and Recovery.** See the signer set, add and remove recovery keys, watch a staged settings change and reject it.
- **Spending Limit.** See the current limit and what is left in the period, set a new one, or remove it. See 3.4.
- **Connected Merchants.** Every Merchant the Consumer has an active Session with, and a one-tap revoke that forces a full passkey ceremony next time.

Plus notifications, address book, edit account name, contact support, and delete Account.

### 3.8 Restoring onto a new phone

Fully built. The home screen tells the Consumer their phone cannot approve Spends yet. A code goes to the email on file. Verifying it produces a fifteen-minute grant that covers proposing and approving the swap and deliberately does not cover executing it. The new phone mints a hardware key and attests it, the backend derives the key from the verified attestation rather than trusting the request body, and the change lands after the 24-hour lock. The Account address never changes.

---

## 4. Pay with Xend

### 4.1 The pitch

**A checkout button any online store can place next to card and Apple Pay. A shopper taps it, confirms with a fingerprint or face, and pays instantly from their Xend balance. The store gets paid in digital dollars, or in naira if it prefers.**

To a shopper it is a payment method, like Apple Pay. To a merchant it is a payment provider, like Stripe or Paystack, one that happens to settle in seconds and in dollars.

### 4.2 Why "an Apple Pay for crypto-settled commerce" is the right frame

Apple Pay's genuine product insight was never the payment. It was this: **the credential you already carry, the one your face unlocks, becomes the checkout.** No card number typed, no account created on the merchant's site, no redirect that feels like leaving.

Xend does the same thing with a passkey and a dollar balance instead of a tokenised card and a bank line:

|                            | Apple Pay                                               | Pay with Xend                                                                 |
| -------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| What authorises            | Face or fingerprint on a device you own                 | Face or fingerprint against a passkey you already enrolled                    |
| What the merchant receives | Card rails, T+2, interchange, chargeback exposure       | Digital dollars in seconds, or naira to the bank, no card-network chargebacks |
| What the shopper shares    | A device token                                          | Nothing. No card number, no account, no personal data                         |
| Who can accept it          | Merchants inside Apple's acquiring and device footprint | Any site that can add a script tag and read a webhook                         |
| Where it works             | Apple devices                                           | Any browser with a passkey, on any platform                                   |

The important asymmetries, and these are the marketing wedge:

1. **It is not device-locked or platform-locked.** Passkeys sync through iCloud Keychain and Google Password Manager, so the same credential works on a phone, a tablet, and a laptop. Apple Pay's reach ends at Apple's device footprint. Xend's does not.
2. **It settles, it does not promise.** The merchant is not waiting two days for money that can be reversed weeks later. Money lands in seconds, and the settlement is final. Refunds are an explicit product flow rather than a chargeback the merchant loses by default.
3. **It reaches people cards do not.** In the launch market, a large population holds dollars and cannot reliably use them online. This is not a card substitute for card users. It is a payment method for people the card networks underserve.
4. **The integration is a script tag.** A merchant does not need a Xend account, does not touch keys, and never learns anything about the chain.

### 4.3 What the Consumer experiences

**First payment at a merchant:**

The shopper reaches checkout and sees Pay with Xend next to the card form. They tap it. A popup opens on Xend's own checkout surface. Because their passkey was enrolled against the Xend root domain, the browser offers it immediately: one Face ID or fingerprint. Xend resolves who they are, checks that their Balance and limits cover the amount, and shows a minimal sheet: merchant name, amount, pay. On approval the payment executes, the popup posts the result back to the merchant page, and the merchant's server gets a signed webhook. It should feel like Apple Pay.

**Returning payment at that merchant:**

The first approval issued a Session scoped to that merchant. The second purchase skips the passkey ceremony entirely and goes straight to a one-tap confirm. Not silent: a one-tap confirm is a deliberate decision, because a fully silent payment is a fraud posture we are not willing to take in v1.

The Consumer can see every Merchant they are connected to in the app and revoke any of them instantly. A revoked Session forces the full ceremony again on the very next attempt.

### 4.4 What the Merchant gets

- **Settlement in seconds**, not T+2.
- **No card-network chargeback exposure.** Refunds are a first-class, partial-capable flow initiated through Xend, not a dispute the merchant loses by default.
- **Fees that undercut card acquiring.** Pricing is two independent basis-point fields, a flat fee and an FX spread, both zero at pilot.
- **Naira or dollars.** A naira merchant prices in naira, the shopper is charged the dollar equivalent at a rate pinned when the payment is created, the dollars land at the merchant's settlement endpoint, and the provider converts and pays the bank. The merchant carries no FX exposure and never holds a dollar balance. A merchant that prefers digital dollars just takes them directly.
- **No keys, no chain, no wallet.** Merchants have no wallet and no signer, by design. They have an internal Xend account pointing at a settlement destination.
- **Test mode is instant.** Test keys issue immediately with no verification gate. Only live keys wait on business verification. **Verification gates real money, never developer experience.** The integration code never changes between test and live; only the key does.

### 4.5 What a developer does

Three steps.

**1. Add the button.** A script tag, or `npm install @xend/checkout-react` and drop in `<XendPayButton />`.

**2. Create the payment intent on your own server.** Money never travels through the browser. Your server calls the Xend merchant API with the amount, resolved from your own data, and hands the browser back a reference. A route handler works; a Next.js Server Action works and is cleaner.

**3. Fulfil on the webhook.** This is the one rule. The button hands your page a reference and a status and nothing else. It carries no amount and no verified flag, on purpose, because a browser message can be forged. Ship the order when your server sees a verified `payment.succeeded` webhook, never when the browser callback fires.

Webhooks are HMAC-signed with a timestamped scheme and a replay window, deliveries are idempotent and retried, and every merchant-facing write takes an idempotency key.

**Proof points a developer page can use:**

- The SDK core has **zero runtime dependencies** and ships at roughly **2.5 KB gzipped**, against a 15 KB budget.
- The hosted checkout bundle is about **62 KB gzipped**.
- Latency budget: **popup interactive in under 1 second** at p95, **approval to result in under 5 seconds** at p95 including chain confirmation, measured on a mid-range Android phone on 4G.
- When popups are blocked, or the shopper is inside an in-app browser (Instagram, WhatsApp, TikTok, Opera Mini and others), the SDK automatically falls back to a signed redirect flow. This is a v1 requirement, not an enhancement, because in-app browsers are how a large share of the launch market shops.
- A single correlation ID traces one payment across every service.

### 4.6 How it works underneath (for a technical page, not the homepage)

- **A hosted checkout surface** at Xend's own subdomain, where the passkey ceremony runs. The merchant page never attempts authentication and never touches keys.
- **The passkey authorises; a separate key signs.** A WebAuthn passkey cannot sign a Solana transaction, so the passkey proves who you are and the Account's own signer moves the money. Two different things, deliberately.
- **An Identity and Capability API** is the single source of truth for who a Consumer is and what they can pay: balance, tier band, limits, risk flags. Policy lives here, not at the wallet layer.
- **A fee-payer relayer** co-signs so the Consumer never holds SOL. It is fee payer only and never a signer, so it has no authority over anyone's money. Its co-sign allowlist deliberately excludes system-level transfers, refuses any transaction where the fee payer is writable, and enforces per-consumer, per-merchant and global caps plus a fee ceiling.
- **A pluggable settlement layer.** Merchants have no wallet. A settlement provider interface handles provisioning a destination, receiving settlement including convert-and-payout, reversing for refunds, and reporting for reconciliation. Direct dollar settlement is the pilot path; the naira provider sits behind the same interface.
- **Sessions are opaque server-side tokens**, not signed tokens. Only a hash is stored, the raw token is never logged or persisted, they rotate on every use, they carry a 90-day absolute lifetime and a 30-day inactivity window, and revocation is immediate and total because validation is a lookup rather than a signature check. A Session proves recognition, not entitlement: every payment still checks live limits and live balance.

---

## 5. Security of the Account

This is the strongest and most under-told part of the product. It is also the part most easily ruined by overclaiming, so read section 9 alongside it.

### 5.1 The problem it solves

The obvious way to build this, and the way most consumer crypto apps do build it, is one key held by one vendor, unlocked by an email login. That means **whoever controls your email inbox can move all your money.** Account takeover through an inbox is not a theoretical attack. It is the attack that actually drains consumer wallets.

Vendor-side multi-factor authentication is a partial answer, because it is enforced by one company. Compromise or coerce that company and it is gone. A threshold enforced on the chain itself cannot be defeated by any single company.

### 5.2 The shape

Every Xend Account is a Squads smart account requiring **two of three signers**. The three are chosen so that each one sits on a genuinely different thing a person controls:

|                 | Signer 1                                   | Signer 2                                           | Signer 3                             |
| --------------- | ------------------------------------------ | -------------------------------------------------- | ------------------------------------ |
| **Anchored to** | Your platform account (Apple ID or Google) | Physical possession of your phone                  | Your email inbox                     |
| **Unlocked by** | Your passkey, on its own                   | A biometric-gated hardware key inside the phone    | Proving control of the email on file |
| **Present for** | Every Spend                                | Spends above your limit, and every settings change | Recovery only                        |
| **Held by**     | Privy                                      | Turnkey                                            | Xend, sealed                         |

**The invariant, stated plainly: no single compromise can reach two signers. Not one vendor, not one inbox, not one platform account, not one device.**

The recovery signer **cannot move money on any path**. Its only authority is to help change the signer set, and that change is delayed 24 hours and surfaced to the Consumer, who can reject it. So even someone who reaches both your passkey and your inbox does not get an instant drain; they get a visible, cancellable, delayed request.

### 5.3 Why it does not feel like security theatre

- **Everyday spending is one tap and one transaction.** A spending limit policy carries small Spends with a single signature. A $6 Send does not ask for a second factor, because a product that did would not survive contact with real users.
- **It works from any device.** A person on a laptop can spend. This rules out designs that require a specific phone for every payment, which is why the obvious "copy the incumbent" approach was rejected.
- **There is no seed phrase.** Anywhere. Recovery is expressible as "enter your email."
- **Recovery is symmetric.** Any two signers restore access and rotate in a replacement for the third. Losing a phone is recoverable. Losing your passkey is recoverable. Losing your inbox is recoverable. Losing two at once is the boundary, and adding a second recovery email moves that boundary.
- **The address never changes** when a signer is rotated. The QR someone saved still works.
- **Your money is never frozen.** The 24-hour lock delays changes to the signer set. It never delays or blocks a Spend.

### 5.4 The verification

The design was tested against the deployed program bytecode, not against documentation. Account creation, threshold enforcement, a two-signature spend in a single transaction, the settings time lock delaying and then releasing, per-policy signer sets, and a synchronous spend while the Account is time-locked all pass. A 2-of-3 spend costs 23,264 compute units and lands in one transaction.

The underlying program is audited by OtterSec and Certora and formally verified by Certora. It is version 0.1 and younger than the alternative we rejected, and that trade is on the record.

### 5.5 The trade-offs, on the record

A marketing page does not need to list these, but nothing on the site may contradict them:

- The under-limit fast path is a single signer. A compromise of that one vendor authorises spends up to the limit without the second vendor being asked. The exposure is bounded by the limit, not eliminated by it.
- A second vendor is now load-bearing. If it is down, spends above the limit are blocked; everyday spends are not.
- Above-limit spends on a laptop need the phone, because the possession factor lives there. Deliberate, but real friction.
- Xend holds the third signer, sealed and email-gated. That is not pure self-custody. It cannot spend on any path and cannot reach the threshold alone, but it is a custody claim we have to stand behind. **Do not write "fully non-custodial" without qualification.**
- Moving from an iPhone to an Android phone is knowingly unsupported unless a second recovery email has been added, because the passkey does not cross platforms.

---

## 6. The decisions that got us here

Each of these is a real fork with a real cost. They are the substance behind any "why is this built this way" section.

### 6.1 No load-bearing external provider

Xend was originally built on a single vendor that bundled account creation, sign-in, signing, balances, transfers, verification and bank accounts behind one relationship. **That vendor was wound down.** The forced migration exposed the structural problem: if one company disappearing can take Xend offline, the architecture has a dependency we do not control.

The rule that came out of it, and it blocks code review to this day: **no vendor SDK is imported outside the single adapter that owns it.** Every provider category (signing, settlement, RPC, exchange rates, cache, event log) sits behind an interface Xend owns. Swapping a vendor rebuilds one module by design.

Second half of the same rule: **no provider key ever lives in the app runtime.** Keys that had leaked into the mobile bundle were removed as part of the same pass.

This is worth telling publicly, carefully. It is the most credible reliability claim Xend has, because it was paid for.

### 6.2 The Account is a 2-of-3 smart account, not a single key

Covered in section 5. The alternatives considered and rejected: vendor-enforced MFA on a single key (defeated by compromising one vendor, and key export is on by default, which ends the discussion permanently), the older and more battle-tested multisig program (three to four transactions per spend, which destroys the product), and copying the closest incumbent exactly (hard-binds the account to Apple and locks out Android consumers).

This had to land before any public listing, because moving the Account changes every Consumer's receive address. Shipping first would have meant telling people the address they saved is no longer theirs.

### 6.3 Balance updates only on confirmation

Most consumer payment apps show an optimistic balance for snappiness. Xend does not. The Activity appears immediately as "Sending"; the Balance moves only when the chain confirms. Accuracy and trust over perceived speed, deliberately.

### 6.4 Recovery is seedless and email-anchored

No seed phrases, no mnemonics, no recovery codes, no social recovery. Recovery is driven by the signer set: any two signers restore access and enrol a replacement for the lost one. The email alone is never sufficient.

An earlier draft of this design made the sign-in email unlock the primary signer, which forced the recovery email to be a different address and meant asking for two emails at signup. Reworking the signer set so the passkey alone carries the primary signer collapsed that to **one email, collected once.**

### 6.5 Checkout is passkey-only, and that constraint drove the whole security model

"Pay with Xend" on a merchant page must prompt the passkey and nothing else. No app, no login, no code. That is the product. It is also the constraint that decided the anchor of every signer, because if the passkey alone completes a payment then the passkey alone completes the primary signer, and everything else has to arrange itself around that.

### 6.6 Identity is minted in the app, never at checkout

The checkout only authenticates an existing Consumer. It never creates one. Creating an identity at checkout mints a second, orphaned account with a passkey and no email, and the person's payment then lives on an account invisible in their app.

Consequence, decided: **the consumer app stays mobile-only. There is no desktop app.** Desktop shoppers are covered by synced passkeys (Face ID on their own machine) and a cross-device phone handoff. The phone stays the source of truth.

### 6.7 The webhook is truth; the browser is convenience

The browser message carries a reference and a status and nothing else, deliberately. No amount, no verified flag. A browser message can be forged, so it can never be settlement truth. This is a hard architectural line and it is worth stating on the developer page because it is the difference between a payment method a merchant can trust and one they cannot.

### 6.8 No consumer KYC inside checkout, ever

Compliance attaches at the fiat boundary and to the merchant. Inside a checkout path, capacity is enforced by tier limits on every payment plus clean audit trails. A shopper is never asked for documents in a merchant's popup.

### 6.9 Merchants hold no keys and no wallet

Three revisions landed here. The final shape: a merchant has an internal Xend account referencing an external settlement destination provisioned through a pluggable provider layer. There is no merchant signer and therefore no merchant-signed reversal. Refunds run in reverse through the settlement provider, initiated by Xend, partial-capable, at the live rate at the time of the refund.

### 6.10 Convert at settlement, so the merchant carries no FX risk

A naira merchant prices in naira. The rate is pinned when the payment intent is created. The shopper is charged the dollar equivalent. Dollars land at the settlement endpoint and the provider converts and pays the bank. The merchant receives naira, never holds dollars, and carries no exchange exposure.

### 6.11 Sessions are opaque and instantly revocable

A signed token would have been the familiar choice. It was rejected because a Session is not an identity claim, it is a long-lived spending capability that a person must be able to kill instantly. Opaque server-side tokens give one validator, instant revocation as a single row update, and no signing keys or claim-parsing attack surface. The cost, a database lookup on every use, is paid deliberately.

### 6.12 Build the relayer rather than adopt one

A timeboxed evaluation of the existing open-source option ended in building a thin service instead, on operational burden grounds, with the configuration deliberately shaped so that reversing the decision later swaps one implementation rather than rewriting the design.

### 6.13 Solana only

Cross-chain tooling was explicitly removed from the stack and is not permitted to return. When a bridge appeared as a fallback for an unavailable payout route, it was rejected rather than built, and the gap was escalated as a decision for a human instead.

### 6.14 Strictly monochrome, with all colour in photography

Covered in section 2.5. The system has no brand colour on purpose. The warmth problem that pure monochrome creates is solved by photography rather than by introducing a hue.

---

## 7. Roadmap

Three horizons. Nothing here should appear on a marketing site as available; label anything from Next or Later clearly, or leave it off.

### Now (built, in pre-launch or pilot)

- Consumer app: Account, Cash, Send, Receive, Activity, Contacts, Spending Limits, Investments, Swap
- 2-of-3 Account with policies, staged settings changes, recovery keys, lost-phone restore
- Sponsored network fees
- Pay with Xend: hosted checkout, merchant API, webhooks, refunds, the SDK, the internal operations console
- Connected Merchants and Session revocation in the app

### Next

- **Xend Card.** A virtual card to spend the balance anywhere, online and in store, addable to the phone for tap to pay, freezable instantly, with no top-up beforehand.
- **Xend Plus.** A membership for daily users: no network fees, shielded send and receive, a virtual bank account, and the Card included.
- **Virtual bank account.** Send and receive ordinary bank transfers into and out of the Account.
- **Earn deposits.** The position screen and the products are built; funding them is the remaining work.
- **Hide my wallet.** Send and receive without revealing the Account address. The toggle exists; the mechanism behind it does not.
- **Naira payouts to merchant bank accounts.** Built behind the provider interface and currently switched off pending a settlement route that works natively on Solana.
- **The merchant portal.** Self-serve profile and keys, payments and payouts views, refund approval, metrics. Today this is an internal operations console (payments, webhook deliveries, API key fingerprints and Consumer Accounts, with two write actions: webhook redelivery and freezing the release of an Account's recovery signer) plus a manual operations script running the same four-stage onboarding model.
- **Publishing the SDK to npm** and the public developer documentation around it.

### Later

- **Multiple balances.** More than one stablecoin per Account, at which point the headline figure becomes a Total Balance summed across them. The Activity feed stays unified.
- **Send to a person by email.** Today email is authentication and contact only, never a payment destination.
- **Credit, underwritten by Xend.** Every Payment writes history. The capability API is shaped so that an embedded checkout can eventually offer Xend-underwritten credit at the point of sale. The seam exists; the endpoint does not.
- **Additional settlement providers and additional currencies** behind the existing interface, in additional African markets.
- **Privacy work on balances**, currently unresolved research and treated only as a compatibility constraint.
- **NFTs** as a surface in the app.

---

## 8. Facts and figures a site may use

Everything here is measured or shipped, not estimated. Nothing else should be presented as a number.

| Claim                                   | Value                                                         |
| --------------------------------------- | ------------------------------------------------------------- |
| Signers required to move money          | 2 of 3                                                        |
| Delay on any change to the signer set   | 24 hours, rejectable by the Consumer                          |
| Cost to create an Account               | 0.00252452 SOL, paid by Xend, invisible to the Consumer       |
| Compute for a 2-of-3 spend              | 23,264 units, one transaction                                 |
| Program audits                          | OtterSec and Certora, formally verified by Certora            |
| Checkout SDK size                       | Roughly 2.5 KB gzipped, zero runtime dependencies             |
| Hosted checkout bundle                  | Roughly 62 KB gzipped                                         |
| Popup interactive                       | Under 1 second at p95, mid-range Android on 4G (budget)       |
| Approval to result                      | Under 5 seconds at p95, chain confirmation included (budget)  |
| Session lifetime                        | 90 days absolute, 30 days of inactivity, rotates on every use |
| Merchant fees at pilot                  | Zero                                                          |
| Consumer KYC required to pay a merchant | None                                                          |
| Seed phrases anywhere in the product    | None                                                          |

**Numbers that do not exist yet and must not be invented:** user counts, transaction volume, merchant counts, processed value, uptime, funding, team size.

---

## 9. Honesty ledger: what is not true yet

A marketing site must not contradict any line in this section.

- **The app is in private beta, invite-only.** It is not generally available.
- **No Squads Account has been created, provisioned or spent from on mainnet.** Every Account, provisioning run and Spend so far has been devnet or local. Mainnet is not untouched, though: the app defaults to mainnet (`apps/mobile/utils/cluster.ts`), and a real USDC deposit landed on a mainnet Privy wallet, which is what forced that default. Roughly 0.75 USDC from the dApp Store reviewer also sits on a mainnet Privy wallet awaiting the sweep. The first mainnet Account is a listed pre-launch step, not a done one.
- **Xend Card does not exist.** The screen is a preview of a promise. No card has been issued.
- **Xend Plus does not exist.** Same.
- **Earn deposits do not work.** The position reads correctly and there is no way to fund it.
- **Hide my wallet does not work.** The toggle renders and there is nothing behind it.
- **Virtual bank accounts are not live.** The older documentation describing them belongs to a discontinued vendor integration.
- **Naira payouts are switched off.** The adapter is built and gated, pending a settlement route that works natively on Solana.
- **The merchant portal does not exist.** There is an internal operations console behind Basic Auth (read views plus webhook redelivery and the recovery-signer freeze) and a manual script.
- **The SDK is not published to npm.** It is built, tested, and size-gated, and no release has been cut.
- **No real merchant has taken a live payment.** The end-to-end flow is proven on devnet with a real passkey ceremony.
- **Refunds work for dollar settlement only.** The naira path is capability-gated off.
- **"Non-custodial" needs a qualifier.** Xend holds the sealed recovery signer. It cannot spend and cannot reach the threshold alone. Say what is true, not the shorthand.
- **A Nigerian securities-law opinion is outstanding** and gates mainnet go-live. Do not publish regulatory claims.
- **Do not claim any partnership, listing, or integration by name** without checking. Several vendor relationships are load-bearing internally and none are announced.

---

## 10. Suggested message hierarchy for the website

A starting structure, not a mandate. It follows the positioning rather than the feature list.

**Consumer home**

1. Hero: "Money, but faster." One line beneath it about holding dollars and sending them in seconds. One call to action. The private-beta state stated honestly.
2. The balance, big. A Balance is always the largest thing in a frame that shows one.
3. Send, in three beats: pick someone, enter an amount, done. No chain vocabulary anywhere.
4. Security, told as relief rather than as cryptography: no seed phrase, no password, your face is the key, and losing your phone is not losing your money. The 2-of-3 shape explained in one plain sentence.
5. Pay with Xend from the shopper's side: pay online with your face, share no card number.
6. What is coming, honestly labelled.

**Merchant and developer**

1. Hero: get paid in seconds, not in two days. The button, shown in place next to card and Apple Pay.
2. The three-step integration, with real code. Script tag and React side by side.
3. The one rule: fulfil on the webhook.
4. Settlement: naira to your bank, or digital dollars. No FX exposure. No keys.
5. Trust surface: no chargebacks in the card-network sense, refunds as an explicit flow, signed and idempotent webhooks, test mode instant and ungated.
6. The numbers from section 8, in mono, with tabular figures.

**Everywhere**

Monochrome. Photography carrying every coloured pixel: macro on the consumer pages, aerial on the merchant pages, never mixed. Emphasis by weight and inversion, never by hue.

---

## 11. Provenance

Assembled from the repository at `xend-mobile`: the domain glossary (`CONTEXT.md`), the architecture decision records under `docs/adr/`, the specifications under `docs/specs/` (in particular the account security model, the merchant onboarding model, the integration quickstart, and the passkey and recovery handoff), the Pay with Xend platform plan and build log, the shipped mobile application source, and the brand system in the `xend-assets` repository (`BRAND-TOKENS.md`, `BRAND-KIT.md`, `AVOID-LIST.md`).

When this document and the repository disagree, the repository wins and this document should be corrected.
