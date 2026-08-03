# Xend

A mobile payments app for everyday consumers — spend money as you would, but faster. P2P payments to friends are the dominant case; merchant payment rides the same rails. The crypto rails underneath (Solana, USDC, Squads smart accounts, passkey auth) are invisible to the user.

## Language

### Product

**Xend**:
The product. Always capitalized as a proper noun.
_Avoid_: wallet, app

**Consumer**:
An everyday person using Xend. Not crypto-native.
_Avoid_: user, trader, holder, wallet user

### Identity

**Account**:
The **Consumer**'s Squads smart account on Solana. Holds their **Cash**. Exactly one per **Consumer**.
_Avoid_: wallet, smart wallet, smart account (in user-facing copy — "**Account**" is the term), profile

**Passkey**:
The platform-keychain-stored auth primitive paired with the **Consumer**'s email. Together they unlock the **Account**. Not device-bound — synced across devices on the same Apple ID / Google account via iCloud Keychain / Google Password Manager. An iPhone and iPad on the same Apple ID share the same **Passkey**.
_Avoid_: key, credential, login, device key

**Recovery Email**:
An additional email attached to the **Account** for use during **Recover**. A **Consumer** can have several. It must differ from the sign-in email: the sign-in email already unlocks a signer, so reusing it would collapse two independent factors into one.
_Avoid_: backup email, secondary email, alt email

**Recover**:
The action a **Consumer** takes to regain access to their **Account** on a new device (e.g. switched to an Android phone, lost access to their Apple ID). Driven by the **Account**'s signers, not by email: any two of them together restore access and enroll a replacement for the lost one. The sign-in email alone is never sufficient. See `docs/specs/account-security-model-decisions.md`.
_Avoid_: restore, reset, sign back in

### Money

**Cash**:
The feature area of Xend that covers everything about the **Consumer**'s money — the screen, the actions on it, the value it holds. "Cash" is the surface; **Balance** is the number on it.
_Avoid_: wallet, funds, holdings, tokens

**Balance**:
The numeric amount of **Cash** in an **Account**, displayed in the **Consumer**'s native currency (e.g. "$42.17"). Currently backed 1:1 by USDC on Solana — invisible to the **Consumer**. Today there is exactly one **Balance** per **Account**; multiple **Balances** (other non-dollar stablecoins) are a planned evolution — when that happens, the headline figure becomes a **Total Balance** summed across them.
_Avoid_: amount (when referring to the headline number), funds

### Movement

**Spend**:
The umbrella concept for any outflow from a **Consumer**'s **Account** — whether to a friend (P2P) or a merchant. Captures the sender's intent. The headline verb of the product, but **not** the in-app button label.
_Avoid_: transact, pay (as the umbrella — fine in merchant context)

**Send**:
The in-app action verb for executing a **Spend** to another **Address**. The button label, the route name (`(send)`), the natural verb when narrating ("Sarah sent me $20").
_Avoid_: transfer, push

**Sending**:
The verb form the **Consumer** sees while a **Spend** is in flight — a spinner plus "Sending…". The conceptual state behind it is **Pending**, but that word is not shown to the **Consumer**.
_Avoid_: in progress, processing, submitting, awaiting

**Spend Status**:
The state of a single **Spend** as an **Activity**. Three values, no commitment-level nuance from Solana surfaced:

- **Pending** — in flight (shown as **Sending**)
- **Sent** — confirmed on-chain
- **Failed** — confirmed-failed on-chain (no human-friendly reason language today; just "Failed")

**Balance** only updates when the change actually occurs on-chain — never optimistically. While **Pending**, the **Activity** appears but the **Balance** has not yet moved.
_Avoid_: transaction state, tx status

**Receive**:
The umbrella concept for any inflow to a **Consumer**'s **Account** — from another **Consumer**, an on-ramp (card → USDC), a bank deposit, or an external crypto wallet. One word covers all sources; the **Consumer** does not distinguish "top up" from "deposit" from "incoming P2P".
_Avoid_: top up, deposit, fund, add cash, incoming

**Spending Limit**:
A self-imposed cap a **Consumer** sets on outflow per period — enforced before a **Spend** executes. Lives in settings.
_Avoid_: budget, cap, allowance

### Timeline

**Activity**:
A single event in an **Account**'s timeline. Covers **Spends** (including pending and failed), **Receives**, and non-money events (e.g. saving a **Contact**, setting a **Spending Limit**). Per-**Account** — even when multiple **Balances** exist, they share one **Activity** feed.
_Avoid_: transaction, event, entry, item

**Activities**:
The plural form — the unified, reverse-chronological feed of all **Activity** in an **Account**. The "Activity" tab is the surface.
_Avoid_: history, ledger, log, timeline, feed

### Destinations

**Address**:
The canonical destination of a **Spend** — a Solana public key. The thing that's actually transferred to under the hood.
_Avoid_: pubkey, wallet address, account address

**SNS Name**:
A `*.sol` name (Solana Name Service) the **Consumer** can type or scan to specify a **Spend** destination. Resolves to an **Address** at Spend time. An input convenience, not a stored identity.
_Avoid_: domain, handle, username, ENS

**Contact**:
A saved **Address** plus a label, in the **Consumer**'s address book. Not a social connection; not a directory entry; not a stored input form — purely a personal shortcut for frequent destinations.
_Avoid_: recipient, payee, friend, merchant, connection

### Commerce

**Merchant**:
An online store that accepts **Payments** from a **Consumer**'s **Balance** through **Checkout**. Hand-picked at pilot. A **Merchant** is not a **Contact**; it never appears in the address book.
_Avoid_: vendor, store (in code), business, seller

**Payment**:
A **Consumer** paying a **Merchant** from their **Balance** through **Checkout**. The **Merchant**-facing counterpart of a **Spend**: it rides the same rails and appears in the **Consumer**'s **Activity**. Settles to the **Merchant**'s settlement **Account** in digital dollars.
_Avoid_: transaction, charge, order, purchase (in code)

**Checkout**:
The Xend-hosted surface (pay.xend.global) where a **Consumer** approves a **Payment** with their **Passkey**, or with one tap when a **Session** is active. Sits next to card and Apple Pay buttons on the **Merchant**'s page.
_Avoid_: payment page, widget, popup (in user-facing copy), iframe

**Session**:
A **Merchant**-scoped recognition that a **Consumer** already completed the **Passkey** ceremony for that **Merchant**. Lets repeat **Payments** skip the ceremony for a one-tap confirm. It expires, and the **Consumer** can revoke it at any time; a revoked **Session** forces the full ceremony again.
_Avoid_: token, login, remember-me, refresh token (in user-facing copy)

**Payout**:
Movement of settled **Payment** funds from a **Merchant**'s settlement **Account** to the **Merchant**'s bank account in local currency. A later, gated capability.
_Avoid_: withdrawal, off-ramp (in user-facing copy), settlement (as a synonym for Payout)

## Relationships

- A **Consumer** has exactly one **Account**
- A **Consumer** authenticates with an email + **Passkey** to unlock their **Account**
- A **Consumer** may attach one or more **Recovery Emails** to their **Account**; each backs a recovery signer, and none of them alone can drive **Recover**
- An **Account** holds **Cash**, whose value is shown as a **Balance**
- A **Spend** is an outflow from the **Account**; **Send** is the in-app action for executing one
- A **Receive** is an inflow to the **Account** from any source
- A **Consumer** has an address book of **Contacts** (saved **Addresses** with labels)
- A **Spend** flows from the **Account** to an **Address** — specified directly, via an **SNS Name**, or by picking a **Contact**
- A **Spending Limit** is checked before a **Spend** executes
- Every **Spend**, **Receive**, and non-money event in an **Account** produces an **Activity**; the **Account**'s **Activities** feed is the unified, reverse-chronological list
- A **Payment** flows from a **Consumer**'s **Account** to a **Merchant**'s settlement **Account**, approved through **Checkout**
- A **Payment** is a **Spend** whose counterparty is a **Merchant**; it appears in the **Consumer**'s **Activities** like any other **Spend**
- A **Session** binds one **Consumer** to one **Merchant** and lets repeat **Payments** skip the **Passkey** ceremony until it expires or is revoked
- A **Payout** moves settled **Payment** funds from a **Merchant**'s settlement **Account** to that **Merchant**'s bank account

## Example dialogue

> **Dev:** "When a **Consumer** picks a **Contact** and taps Send for $20, what actually happens?"
> **Domain expert:** "We resolve the **Contact** to its **Address**, check it against any active **Spending Limit**, then submit the **Spend** on-chain. The **Activity** appears immediately as **Pending** with a spinner and 'Sending…'. **Balance** doesn't move yet — it only updates once the change confirms on-chain. Then the **Activity** flips to **Sent** and **Balance** drops by $20. If it confirms failed, the **Activity** is **Failed** and **Balance** never moves. The recipient sees a **Receive** on their side — also as an **Activity**."
> **Dev:** "And if they typed `gifted.sol` instead of picking a **Contact**?"
> **Domain expert:** "Same thing — we resolve the **SNS Name** to an **Address** at Spend time. They could optionally save it as a new **Contact** afterwards."

## Flagged ambiguities

- "Send" vs "Spend" — resolved: **Spend** is the umbrella concept (sender's intent, marketing verb, covers P2P + merchant); **Send** is the in-app action verb for the P2P flow. The `(send)` route is correctly named.
- "Cash" vs "Balance" — resolved: **Cash** is the feature/section; **Balance** is the numeric value. Not synonyms.
- "Wallet" appears in some UI copy (e.g. Spending Limits help text: "your wallet can handle...") — flagged as a mistake to fix. The term is **Account**.
- Email is part of auth but **not** a payment destination today — Consumer-to-Consumer Spend by email is TBD. For now, destinations are **Address** or **SNS Name** only.
- "History" appears in code as a route filename, type, and screen name (`history.tsx`, `History`, `HistoryScreen`) — flagged as legacy naming. The user-facing concept is **Activity** / **Activities** (matches the tab header and `ActivityList` component).
- "Spend" vs "Payment", resolved: **Spend** remains the Consumer-side umbrella for any outflow (P2P or merchant); a **Payment** is the specialization where the counterparty is a **Merchant** via **Checkout**. Every **Payment** is a **Spend** and lands in **Activity**, but not every **Spend** is a **Payment** (a P2P **Send** is not). **Send** stays the P2P action verb; **Checkout** is the surface where a **Payment** is approved.
