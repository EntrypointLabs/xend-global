# 0027: Email is an entry point that unlocks S3, never a login method that returns S1

**Status:** Accepted
**Date:** 2026-08-30
**Deciders:** Xend founding team
**Tags:** mobile, backend, security, wallet, pay

## Context and Problem Statement

[0025](0025-account-multisig-signer-set.md) made sign-up passkey-first and collected
the email afterwards, on `apps/mobile/app/add-email.tsx`. That order came out of a
correct reading of D4: if the passkey alone completes a checkout **Payment**, then the
passkey alone completes S1, so S1's anchor is the platform account and email must not
unlock it.

The ordering was then treated as though it followed from that. It does not. D4
constrains **what an email may unlock**. It says nothing about **when an address is
collected**. Conflating the two bought no security and cost three things:

1. **A dead end on a fresh install.** On a device holding no credential for the
   relying party, Android does not answer `NoCredentials`; it offers to sign in from
   another device, and backing out of that reads as a cancellation. The path that
   revealed "create an account" was therefore unreachable for exactly the person who
   needed it. `apps/mobile/app/(auth)/login.tsx` carries a separate "New here? Create
   an account" button solely to work around this.
2. **No durable record of a **Consumer** until Privy has one.** XEN-29 held passkey
   sign-up broken for weeks. Anyone who hit it was left with nothing on file and
   nothing to resume.
3. **D10b enforced by a screen guard rather than by sequence.** S3 is mandatory at
   **Account** creation, and today that is held up by `add-email.tsx` refusing to let
   anyone leave except through a proved address or a sign-out.

Separately, `O10` is still open: `apps/mobile/app/(auth)/email-login.tsx` runs Privy's
email OTP, which returns the same embedded wallet that is S1, so an inbox reaches the
whole daily spending limit with no second approval and no time lock.

Both questions are about email, and they have different answers. This ADR separates
them and settles both.

## Decision Drivers

- **The invariant is about anchors, not ordering.** Email anchors S3, the passkey
  anchors S1, the phone anchors S2. Collecting the address earlier moves no anchor.
- **Email verification is already ours.** `auth/email/challenge` and `auth/email` are
  Xend endpoints issuing Xend codes, scrypt-hashed with a per-row salt and a ten
  minute expiry. Proving an address has never touched Privy and does not need to.
- **The schema already permits it.** `users.id` is our own cuid and the Privy linkage
  lives in `smart_accounts.provider_user_id`, so a `users` row can exist before a
  Privy user does. `users.email` is already nullable and unique.
- **Checkout does not move.** Tapping "Pay with Xend" on a **Merchant** page prompts
  the passkey and nothing else. That is the product and this ADR leaves it untouched.
- **A front door has to cross ecosystems.** Passkey sync covers Apple-to-Apple and
  Google-to-Google. iPhone to Android is the case it does not cover, and it is the
  case a universal entry point exists for.
- **No **Consumer** exists in production.** Breaking changes are free now and will not
  be after the dApp Store listing, which is general availability.

## Considered Options

1. **Email first as an entry point, then passkey, then Turnkey** - the address is
   proved before anything else, S3 is minted against it, the passkey creates S1, the
   phone creates S2. Email may later open a limited session.
2. **Keep passkey-first, add email as a recovery door only** - leave sign-up as it is
   and let a stranded **Consumer** in through the existing recovery challenge.
3. **Email as a Privy login method alongside the passkey** - both routes return a
   Privy session.

## Decision Outcome

Chosen option: **"Email first as an entry point, then passkey, then Turnkey"**,
because it fixes all three costs above without moving a single anchor, and because
option 3 is `O10` restated and option 2 leaves the fresh-install dead end and the
missing durable record in place.

### The rule, in one line

**Email proves the inbox and unlocks S3. It never returns S1 and never enrols a
signer.**

Everything below is a consequence of that sentence. It is the sentence to check any
future change against.

### Sign-up order

| Step | What proves it              | What it creates                                               | Anchor           |
| ---- | --------------------------- | ------------------------------------------------------------- | ---------------- |
| 1    | A six-digit code we mailed  | The `users` row, and S3 minted and sealed against the address | email inbox      |
| 2    | The platform passkey prompt | The Privy user and embedded wallet, which is S1               | platform account |
| 3    | An attested hardware key    | The Turnkey approval signer, which is S2                      | the phone        |
| 4    | -                           | The **Account**, created with all three signer pubkeys        | -                |

Step 4 stays last because **Account** creation needs S1's pubkey. "S3 first" means
S3 is minted, sealed and anchored first, not that it is a signer on anything before
the **Account** exists.

The three anchors are unchanged from D4. So is the invariant: **no single compromise
may yield `threshold` signers.**

### What an email session may and may not do

An email code opens a **limited session**: our own token, no Privy session behind it.

| Capability                                 | Allowed |
| ------------------------------------------ | ------- |
| Read balances, activity, settings          | Yes     |
| Start the lost-phone rotation flow         | Yes     |
| **Spend**, at any amount                   | **No**  |
| Change the signer set or a policy          | **No**  |
| **Enrol a passkey on an existing Account** | **No**  |

The last row is the one that matters and the one that is easy to get wrong. An email
session that can mint a fresh passkey mints a fresh S1, and one mailbox then holds S1
and S3 together, which is the precise outcome D4 was rewritten to prevent. Replacing
a passkey goes through the threshold, exactly as rotating the **Device Key** does.

These limits are enforced server-side, on the token's tier. Not by hiding buttons.

### Sign in with Google is rejected

Considered and dropped. Under D4 the platform account is S1's anchor, because Google
Password Manager holds the passkey. For a **Consumer** on Android with a Gmail
address, "Continue with Google" makes the Google account both the passkey store and
the inbox, which merges S1's anchor with S3's. The same reasoning already disqualified
Turnkey OAuth for S2 in the rejected table of the decisions spec. Emailed codes stay
the only entry proof.

That overlap exists today by accident for an Android **Consumer** using Gmail. This
decision declines to make it a designed entry point; it does not claim to have removed
it.

### Changing the contact address is a signer rotation, not an edit

There is no "edit email" operation in the product. The address moves by rotating the
signer it anchors: a settings change, 2 of 3, the 24 hour lock, notified. The entry
point is **derived** from whichever address anchors the recovery signer, so it follows
the rotation, and it moves **on execution, not on staging**. Staging alone must never
hand over the door, because staging is what an attacker does.

A **Consumer** whose inbox is compromised still holds S1 and S2, which is threshold.
That is the whole path: their own two signers replace the third. The attacker holds
one vote, cannot spend on any path, and cannot reject the change.

Consequences for the two existing services:

- `auth/email` stays the **initial** write during sign-up, where there is no previous
  address and nothing to re-anchor. It stops being reachable as an edit once an
  **Account** exists.
- `reanchorEmailSigner`'s instant path is therefore dead for the contact address, and
  `changeEmail` (a fresh keypair, because the old inbox may be exactly what was
  compromised) becomes the only route, wrapped in the settings change it currently
  lacks.

**Proof of the old address was considered and rejected.** An instant re-anchor gated
on codes to both inboxes defends against a stolen session and is worthless against a
compromised one, because the attacker can prove the old address too. Since the heavy
path is required for the case that matters, a light path only adds a weaker route an
attacker would choose. One door.

The typo case that `changeEmail` was written for mostly disappears under this ADR: a
**Consumer** cannot finish signing up with a mistyped address, because they would
never receive the code.

### Support can refuse, and cannot override

0025 leaves `settings_authority` unset, so the **Account** is autonomous and rejecting
a pending change requires S2. Nobody at Xend can cancel a rotation on a **Consumer**'s
behalf, and that stays true: an override able to move an anchor is a fourth anchor and
it voids the invariant.

The lever we do have is **refusal**. We hold S3, so we can decline to release it while
a compromise report is open. Declining to sign is not the same as being able to sign,
so it costs nothing in the threat model, and it is asymmetric in the right direction:

| Who                                      | Effect of freezing S3's release      |
| ---------------------------------------- | ------------------------------------ |
| A **Consumer** holding phone and passkey | None. S1 plus S2 is still threshold. |
| An attacker holding the inbox            | Drops from one vote to none.         |

Merchant **Session** revocation ([0013](0013-session-model.md)) is the second
off-chain lever and already exists.

### Security notifications

**Every security-relevant change emails the contact address.** Not only the ones a
**Consumer** initiated, and not only the ones that succeed. The mail seam exists
(`apps/backend/src/mail/mail.interface.ts`, Resend behind it), and `account_events`
already carries a dedupe key, so these hang off recorded events rather than being
scattered through the services that cause them.

| Event                                         | Email | Push |
| --------------------------------------------- | ----- | ---- |
| A settings change is **staged**               | Yes   | Yes  |
| A settings change **executes** or is rejected | Yes   | Yes  |
| A recovery key is added, removed or rotated   | Yes   | Yes  |
| The contact address is rotated                | Yes   | Yes  |
| The **Device Key** is rotated                 | Yes   | Yes  |
| A passkey is enrolled on the **Account**      | Yes   | Yes  |
| The **Spending Limit** changes                | Yes   | Yes  |

Three rules that are easy to get wrong and matter more than the list:

1. **A rotation of the contact address mails the old address and the new one.** The
   old address is the one that needs to raise the alarm. The new one only confirms.
2. **Push is the channel that is load-bearing, email is the durable record.** In the
   compromise this defends against, the inbox belongs to the attacker. Email still
   goes out, because it reaches a **Consumer** who is not holding the phone and
   because it is the record they forward to support, but nothing may depend on it
   alone.
3. **None of this is gated on `notificationsEnabled`.** That column is documented as
   whether a **Consumer** wants to be told when money arrives. A pending signer-set
   change is not that, and turning off payment alerts is not consent to silence here.

Deliberately excluded: `wallet_renamed`, and ordinary movement of money. Those are
**Activity** and stay under the preference.

### Accepted risks

Recorded as accepted, not as solved. Each is a decision, and each can be revisited on
evidence rather than on a hunch.

| Risk                                                                                                                                                                          | Why it is accepted                                                                                                                                                                           | What bounds it                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A second recovery key is prompted, never required.** A **Consumer** who declines and then loses both their inbox and their phone holds S1 alone and cannot reach threshold. | Mandating it costs a step in sign-up for a state most **Consumers** never enter, and D10b already guarantees one recovery signer rather than none.                                           | The prompt. It is the only thing between a **Consumer** and that state, so it is offered after sign-up completes and stands persistently on Keys & Recovery. |
| **Gmail on Android merges S1's anchor with S3's.** Google Password Manager holds the passkey and Google holds the inbox, so one compromise yields two signers.                | We cannot design it away without dropping passkey sync, which is the property that makes **Checkout** work on a laptop. Declining "Continue with Google" avoids widening it, not closing it. | S2 on the phone, which the attacker does not have, plus the 24 hour lock and the staged-change push. That push is the entire defence for this population.    |

### O7 is closed by decision, not by an answer

`O7`'s first half was resolved: there is no out-of-band Privy MFA reset. The second
half - whether disabling email login app-wide blocks **Consumers** who already have an
email linked - was never answered by Privy and is now **closed as irrelevant**. There
are no **Consumers** in production. If disabling the method strands the internal test
accounts, they are re-created.

One sequencing consequence, and it is not optional: roughly 0.75 USDC left by the
dApp Store reviewer sits on a mainnet Privy wallet whose only way in may be email.
**Run the sweep before disabling the method**, or the answer to O7 stops being
irrelevant.

### Consequences

- ✅ **Good:** The fresh-install dead end goes away structurally. Knowing who is at
  the door before running a ceremony means running the right ceremony, so the
  "New here? Create an account" workaround comes out rather than being kept.
- ✅ **Good:** There is a durable record of a **Consumer** from step 1, held by us
  rather than by a vendor. A ceremony that fails mid-sign-up is resumable instead of
  stranding somebody with nothing on file.
- ✅ **Good:** D10b becomes structural. There is no **Account** without a proved
  address because the address preceded it, which retires a screen guard that was
  doing security work.
- ✅ **Good:** A universal front door that does not depend on passkey sync, which is
  the only thing that helps an iPhone-to-Android move.
- ✅ **Good:** No anchor moves and the invariant is untouched. Checkout is unchanged.
- ⚠️ **Bad:** An unauthenticated email endpoint is a new spam and enumeration surface.
  `auth/email/challenge` answers a claimed address with a 409 today, which pre-auth
  would leak account existence to anyone. The pre-sign-up response has to be uniform,
  and the existing five-per-hour caps need an IP dimension as well as an address one.
- ⚠️ **Bad:** Binding is now a thing that can go wrong. A verified address and the
  Privy user that later claims it are two separate calls, so a token has to hold them
  together or one **Consumer** binds another's pending row.
- ⚠️ **Bad:** Abandoned sign-ups leave a proved address and a sealed S3 with no
  **Account**. That needs a reaper, and until there is one they accumulate.
- ⚠️ **Bad:** Leading with email trains a **Consumer** to reach for email. The passkey
  is faster on a device that holds one, and the login screen has to keep making that
  the obvious choice rather than burying it.
- ⚠️ **Bad:** The limited session is a second authorization tier in a system that had
  one. Every money-moving and signer-set route now has to be right about which tier it
  accepts, and a route that forgets is a hole rather than a bug.

## Pros and Cons of the Options

### Email first as an entry point, then passkey, then Turnkey

- ✅ Fixes the dead end, the missing record and the D10b guard at once.
- ✅ Moves no anchor; the invariant and checkout are untouched.
- ✅ Reuses machinery that exists: our codes, our grants, our `users` row.
- ❌ An unauthenticated endpoint, a binding token and a session tier to build.
- ❌ Orphan rows that did not exist before.

### Keep passkey-first, add email as a recovery door only

- ✅ Smallest change. Nothing about sign-up moves.
- ❌ Leaves the fresh-install dead end and the workaround button that papers over it.
- ❌ Leaves the **Consumer** with no durable record until Privy has one.
- ❌ D10b stays enforced by a screen.

### Email as a Privy login method alongside the passkey

- ✅ Nothing to build; it is what ships today.
- ❌ This is `O10`. The inbox returns the S1 wallet and reaches the whole daily
  spending limit with no second approval and no time lock.
- ❌ Blocks the dApp Store listing, which is general availability.

## Build map

Ordered. Items 1 to 9 are the sign-up reorder and stand on their own; 10 and 11 are
the entry session and should be their own phase.

**Backend**

1. `POST auth/signup/email/challenge`, unauthenticated. Creates a `users` row for an
   unclaimed address and issues a `contact_verification` challenge against it.
   `recovery_challenges.user_id` is a non-null FK to `users.id`, which is why the row
   comes first. The response is uniform whether or not the address is already on an
   **Account**.
2. `POST auth/signup/email`, unauthenticated. Verifies the code, sets `users.email`,
   and returns an opaque single-use **sign-up token**. Follow [0013](0013-session-model.md):
   random bytes, SHA-256 at rest, raw value crosses the boundary once, short lifetime.
   The challenge `grantId` is a cuid and is not bearer material, so it is not reused
   for this.
3. Move S3 minting and sealing out of enrolment and into step 2, anchored on the
   address that was just proved.
4. `auth/exchange` accepts an optional sign-up token. Present, it binds the Privy user
   to that `users` row by writing the `smart_accounts` row. Absent, current behaviour.
   A Privy user with no token and no matching `smart_accounts` row reaches no `users`
   row, which is what keeps a pending row unclaimable by anyone else.
5. Rate limits follow the endpoints out from behind the JWT guard: per address as
   today, plus per IP.
6. A reaper for `users` rows with a proved address and no `smart_accounts` row.

**Mobile**

7. `add-email.tsx` becomes the first screen of sign-up rather than the last. Its guard
   comment stops being load-bearing and should say what the screen now is.
8. `login.tsx` leads with email. The passkey button stays and stays prominent for a
   returning **Consumer**. "New here? Create an account" comes out.
9. `useAccountSetup` splits: S3 minting moves to the email step, enrolment keeps
   Turnkey and **Account** creation.

**Then, as its own phase**

10. The limited email session, per the capability table above. Server-enforced tier.
    This is the largest piece and the one that actually delivers the cross-ecosystem
    front door.
11. `(auth)/email-login.tsx` and "Recover existing wallet" come out, and email login
    is disabled in the Privy dashboard. **Sweep the reviewer's mainnet balance
    first.** `O10` closes here.

**Rotation and notification, independently of the above**

12. Give `changeEmail` a caller, wrapped in a settings change with the 24 hour lock.
    It has none today: it exists in `recovery.service.ts` with a spec and nothing
    reaches it, so this decision is being made before the button exists rather than
    after.
13. Close the `auth/email` edit path once an **Account** exists, and stop the entry
    point moving on anything but execution.
14. Security email on every event in the table above, keyed off `account_events` for
    idempotency. The enum needs the events it is missing: a rotated recovery key, a
    changed contact address, a staged settings change, and its execution or rejection.
15. The staged-change push, ungated by `notificationsEnabled`. `O4` already says the
    24 hour delay protects nobody without it, and the Gmail-on-Android acceptance
    above makes it the only defence for that population rather than one of several.
16. An S3 release freeze that support can set on an **Account** while a compromise
    report is open.

## Cleanup this creates

Done in the same change:

- `CONTEXT.md` **Passkey** no longer reads "paired with the **Consumer**'s email.
  Together they unlock the **Account**." Since D4 the passkey unlocks S1 on its own.
- `CONTEXT.md` gains **Contact Email** as a term, and **Recovery Email** and
  **Recover** are framed against it. "Sign-in email" is retired: there is no sign-in
  email, there is a contact address, and it anchors S3. The reasoning always held;
  the term did not.
- The decisions spec's D4 note that "the email is collected on a later onboarding
  screen" is marked superseded by this ADR.

Still open:

- The key names in `O8` (**Passkey**, **Device Key**, **Recovery Key**) stay out of
  `CONTEXT.md` until the Keys & Recovery UI exists, which is unchanged by this ADR.

## More Information

- Extends [0025](0025-account-multisig-signer-set.md). Supersedes nothing. 0025's
  signer set, thresholds, policies and anchors are unchanged.
- Decision record and open items:
  [`docs/specs/account-security-model-decisions.md`](../specs/account-security-model-decisions.md),
  D4, D10b, O7, O10.
- Current state:
  [`docs/specs/passkey-and-s3-handoff.md`](../specs/passkey-and-s3-handoff.md).
- Related: [0013](0013-session-model.md) (opaque hashed tokens),
  [0024](0024-privy-adoption.md) (the adapter rule, which applies to both vendors).
- Source: `apps/backend/src/auth/auth.controller.ts`,
  `apps/backend/src/recovery/recovery-challenge.service.ts`,
  `apps/backend/src/db/schema.ts` (`users`, `smart_accounts`, `recovery_challenges`),
  `apps/mobile/app/(auth)/login.tsx`, `apps/mobile/app/add-email.tsx`,
  `apps/mobile/hooks/useAccountSetup.ts`
