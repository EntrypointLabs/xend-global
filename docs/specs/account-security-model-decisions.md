# Account security model: decisions

Working record of the decisions behind moving the **Account** from a single-signer
Privy wallet to a Squads smart account with a 2-of-3 signer set. Precedes the ADR.

Status: decisions settled except where marked **Open**. No users exist yet, so
every Account can be created in its final shape. No migration is required.

## Problem

The Account today is a Privy embedded Solana wallet: one ed25519 keypair, one
signer, threshold 1. The send path is `prepareTransfer` -> Privy `signTransaction`
-> `submitTransfer` (`apps/mobile/app/(send)/confirm.tsx:83`), and
`useWalletAddress()` returns the Privy address, so funds sit at an address a single
key controls.

The passkey in `apps/mobile/hooks/usePasskey.ts` is a Privy login credential, not a
signer on anything.

Whoever controls the sign-in email inbox can complete a login and move all funds.

## The framing that drives everything

A signer is four things, not one:

| Attribute      | Question                                       |
| -------------- | ---------------------------------------------- |
| Key holder     | who has the key material                       |
| Unlock channel | what the human does to make it sign            |
| Permissions    | `Initiate` / `Vote` / `Execute`                |
| Presence       | every spend, above the limit, or recovery only |

**Invariant:** no single compromise may yield `threshold` signers. Not one vendor,
not one inbox, not one platform account, not one device.

Splitting vendors defends against a vendor being compromised, which is rare.
Splitting unlock channels defends against account takeover, which is what actually
drains consumer wallets. The unlock channel column is where the security lives.

A consumer has exactly three identity anchors. Everything else collapses into one
of them:

1. their email inbox
2. their platform account (Apple ID or Google account)
3. physical possession of their phone

So the design rule is one signer per anchor.

## Decisions

### D1. Squads Smart Account Program, not Squads V4

Program `SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG`, mainnet and devnet.

V4 has no synchronous execution path. Every spend outside a spending limit is
`vault_transaction_create` -> `proposal_create` -> `proposal_vote` -> `vault_transaction_execute`,
which is 3 to 4 transactions plus rent for the proposal and transaction accounts.
The Smart Account Program's `transaction_execute_sync` does a 2-of-3 spend in one
transaction carrying two signatures, with no proposal accounts and no rent.

Fuse runs on V4 and tolerates the cost because it is a self-custody wallet. Xend
routes every P2P Send through this path, so the cost is not tolerable.

Tradeoff accepted: the Smart Account Program is v0.1 and younger than V4. It is
audited by OtterSec and Certora and formally verified by Certora.

### D2. No Rust for v1

Thresholds, time locks, spending limits, and program/account/data constraints are
configuration on an already-deployed program.

Note `PolicyState` is a **closed enum** with four variants: `InternalFundTransfer`,
`SpendingLimit`, `SettingsChange`, `ProgramInteraction`. Custom policy types cannot
be registered with the deployed program. Writing our own means deploying our own
program and pinning the Account to it, not plugging into theirs.

### D3. Threshold 2 of 3, autonomous, non-zero time lock on Settings only

`settings_authority` set to default, so the Account is autonomous and no admin key
can override the signers. Every settings change goes through the signer set.

Non-zero `time_lock` on the Settings so a stolen quorum cannot silently rewrite the
signer set. `MAX_TIME_LOCK` is 3 months. Duration is **Open** (O4).

**What the time lock does and does not do.** It delays **settings changes**: adding
or removing a signer, changing the threshold, creating or removing a policy. It does
**not** delay or block Spends. A Consumer's money is never held. The point is that if
someone reaches two signers and tries to rotate the third out, the change sits
pending for the duration, the Consumer is notified, and any remaining signer can
reject it. Without it a stolen quorum rewrites the signer set instantly and silently,
and the Consumer's own keys stop working with no warning.

The tradeoff is only about legitimate changes: a longer window is more protection
against theft and a longer wait when someone genuinely replaces a lost phone.

**Constraint discovered at runtime.** `validate_synchronous_consensus` requires
`consensus_account.time_lock() == 0`, or it throws `TimeLockNotZero` (6051). A
non-zero time lock on the Settings therefore blocks synchronous execution _through
the Settings_. The check is against whichever consensus account is used, and a
Policy is itself a consensus account with its own `time_lock`, so:

- Settings `time_lock` non-zero, governing settings changes only
- Policy `time_lock` 0, so everyday spends stay synchronous

**Every spend must therefore execute under a Policy, never under the Settings
consensus.** Verified end to end (see Runtime verification).

Caught again in the package's own integration suite: a two-signature spend routed
through the Settings **fails** on a time-locked Account, regardless of who signs. So
the above-limit path needs its own policy carrying `[primary, approval]` at threshold
2 with a zero time lock. Until that builder exists, a time-locked Account can only
spend under a spending limit.

### D4. The signer set

Rewritten. Earlier drafts anchored S1 to the email inbox with the passkey as MFA on
top. That is incompatible with the product: **"Pay with Xend" on a merchant page must
prompt the passkey and nothing else.** No app, no login, no OTP. If the passkey alone
completes the payment then the passkey alone completes S1, so S1's anchor is the
platform account and no amount of wishing makes it the inbox.

That propagates: S3 can no longer be the platform account either, or one Apple ID
takeover would yield S1 and S3 together.

|             | S1                            | S2                                                  | S3                                   |
| ----------- | ----------------------------- | --------------------------------------------------- | ------------------------------------ |
| Anchor      | platform account              | physical possession                                 | email inbox                          |
| Key holder  | Privy                         | Turnkey                                             | Xend, encrypted and server-held      |
| Unlock      | **passkey, on its own**       | biometric-gated hardware key on the phone           | proving control of the sign-up email |
| Permissions | `Initiate \| Vote \| Execute` | `Vote \| Execute`                                   | `Vote`                               |
| Present     | every spend                   | above the spending limit, and every settings change | recovery only                        |

Three distinct anchors: the Apple or Google account, the phone, the inbox.

The payoff of the rewrite is that the friction disappears. Under the old shape the
sign-in email unlocked S1, so a recovery email had to be a **different** address,
which meant asking for a second one at signup. Here email does not unlock S1 at all,
so the sign-up email is free to anchor S3. **One email, collected once.**

Signup is therefore passkey-first, which Privy supports via `signupWithPasskey` and
which creates a user with no email attached. The email is collected on a later
onboarding screen and is simply "your email", not a "recovery email".

### D5. Spending limits are optional, and the two-signature path is the floor

Corrected. Earlier drafts assumed every Account has a spending limit and treated the
single-signature path as the default. That is backwards, and it is not what Fuse
does: in Fuse every transaction needs two keys, and a Spending Limit is an **opt-in
that lets you spend without the 2FA key**. Their wallet ships no default limit on
ordinary transfers; the $2,000 daily cap belongs to the Fuse card, not the wallet.

So the model is:

- **The floor is S1 plus S2.** Any Spend an Account cannot justify under a policy
  requires two signatures. This always works and is always available.
- **A spending limit is an optional policy** that carves out a single-signature fast
  path. An Account may have zero, one, or several.
- Xend **does** provision a default one at creation, because unlike Fuse we are a
  payments app where small P2P Spends are the dominant case and a second factor on a
  $6 Send would destroy the product. The amount and period are **Open** (O3).
- A Consumer can raise it, lower it, or delete it outright. **An Account with no
  spending limit is a valid, higher-security state, not an error.** Every Spend then
  takes two signatures.

The consequence for the code: the spend path must **resolve at runtime** whether a
spending-limit policy exists whose constraints admit this amount and destination.
Nothing may assume one is present. `SpendingLimit | null` is the type, and the
two-signature path is the fallback, not the exception.

### D5b. Per-policy signer sets scope S3 out of spending

A `Policy` carries its own signer set and threshold, separate from the Account's:

```rust
pub struct Policy {
    pub settings: Pubkey,
    pub signers: Vec<SmartAccountSigner>,
    pub threshold: u16,
    pub time_lock: u32,
    pub policy_state: PolicyState,
}
```

and `transaction_execute_sync` accepts a `consensus_account` that is either the
Settings or a Policy (`ConsensusAccountType::Policy`). So a transaction can execute
under a policy's consensus rather than the Account's.

| Path                             | Consensus                 | Signers    | Threshold |
| -------------------------------- | ------------------------- | ---------- | --------- |
| Spend under the limit            | SpendingLimit policy      | S1         | 1         |
| Spend over the limit             | ProgramInteraction policy | S1, S2     | 2         |
| Settings change, signer rotation | Settings                  | S1, S2, S3 | 2         |

S3 therefore cannot move money under any path. Its authority is confined to
changing the signer set, which is time-locked and notifiable.

This materially changes the risk math for shared anchors. An S1 plus S3 compromise
can only start a time-locked settings change, which the Consumer is notified about
and which S2 can reject before it matures. That is a survivable failure rather than
an instant drain, and it is why D10's platform rule can be relaxed.

**D5b is required, not an optimization.** Two independent reasons, both verified at
runtime:

1. Vote-only permissions do **not** stop S3 contributing to a spend. S1 plus S3
   successfully spent through the Settings consensus. Only a policy signer set
   excludes S3 from the spend path.
2. Synchronous execution requires the consensus account's `time_lock` to be 0 (D3),
   so a time-locked Settings cannot carry spends at all.

### D6. Funds live at the smart account PDA

Never at the Privy address. If the receive address were the Privy EOA, one key
would control the money and the rest of the design would be theatre.

```
settings PDA      = ["smart_account", "settings", settings_seed]
smart account PDA = ["smart_account", settings_key, "smart_account", account_index]
```

`settings_seed` is `program_config.smart_account_index + 1`, a global incrementing
counter. The address is therefore **assigned at creation, not derived from the
signer set**, so:

- the user-to-address mapping must be persisted and cannot be recomputed
- rotating any signer does not change the address
- receive address, QR, and deposit destinations all point at `account_index` 0

`useWalletAddress()` returns the PDA. The Privy address becomes an internal signer
identifier the Consumer never sees.

### D7. Relayer is fee payer only, never a signer

Keeps sends gasless without giving the relayer any authority over funds. It is also
not an enforcement point, since a user holding two signers can pay their own fee and
submit directly.

### D8. One passkey in the product

The passkey the Consumer adds is the **Privy** passkey. It covers login, checkout,
and everyday spends. A Turnkey credential cannot be the same one: a WebAuthn
assertion is verified by the relying party that registered it, against its own
stored public key and its own challenge.

S2's authenticator is therefore separate. **Open**, see O1.

### D9. No session signers

Session signers bypass wallet MFA by design. An unscoped one hollows out S1
entirely, and even a scoped one must never reach the two-signature path. Since the
product wants a passkey tap per payment anyway, they are not needed.

### D10. Recovery menu, ordered

1. Back up to iCloud or Google (default, platform-detected)
2. Recovery email, which **must differ from the sign-in email**
3. External wallet (advanced, behind "other options")

Up to 3 recovery signers, matching Fuse. Each additional one adds pairs that can
spend, since any Active plus any Recovery meets the threshold. Say so in the copy
rather than hiding it.

**Shared-anchor rule, inverted by D4.** Earlier drafts required the recovery email to
**differ** from the sign-in email, because the sign-in email unlocked S1. Under D4 it
does not: the passkey unlocks S1 and email unlocks nothing else. So the sign-up email
is exactly the right anchor for S3, and there is no second address to ask for.

What must not share an anchor now is S1 and S3, which is why S3 moved off the platform
account entirely. See D10b.

D5b still applies and still matters: S3 cannot participate in any spend path, so even
a compromise reaching both S1 and S3 yields a time-locked, notified settings change
rather than a drain.

### D10b. S3 is mandatory at Account creation

Threshold 2 with only two real signers means losing either is terminal. The Account
is created with three signers or it is not created. Fuse permits the no-recovery
state (their 1-of-2 default) and D3 already rejects it.

This is realistic because S3 provisions silently: generate a keypair, encrypt it,
write it to iCloud Keychain or Google Block Store. No user interaction beyond the
platform consent already being given.

### D10c. Device changes rotate the authenticator, not the signer

S2's Squads signer is an ed25519 key held by Turnkey. It never touches the phone.
The Secure Enclave or Keystore key is the **authenticator** that authorizes Turnkey
to sign. Hardware keys are non-exportable by design, so there is no porting, only
rotation.

| Case                      | Path                                                                                                                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Old phone still available | Authorize on the old device, add the new device's hardware key as an authenticator on the same Turnkey sub-org, remove the old one. S2 pubkey unchanged, Account settings untouched, no Squads transaction, S3 not needed.                |
| Old phone lost            | The sub-org is unrecoverable (email auth and recovery are disabled). Create a new sub-org with a new ed25519 key on the new device, then a Squads settings change swapping the old S2 pubkey for the new one. Threshold 2, so S1 plus S3. |

A planned device switch is therefore a non-event. Only a lost phone is a recovery
event.

### D11. Enforcement layers, in order of reach

1. **On-chain, config only.** Threshold, permissions bitmask (`Initiate=1`,
   `Vote=2`, `Execute=4`), time lock, spending limits, and `ProgramInteractionPolicy`
   with per-program constraints, account constraints, data constraints, pre/post
   hooks, and per-policy spending limits.
2. **Turnkey policy engine.** Velocity rules, destination cooldowns, tier caps.
   Updated over an API with no chain deploy and no app release.
3. **Own Rust program.** Only for rules that must survive a hostile client.

Layer 2 is reliable, not unavoidable: any pair of signers meets the threshold, so
S1 plus S3 can execute without touching Turnkey. Fine for fraud and velocity rules.
Not sufficient for revenue treated as non-negotiable.

### D12. Fees

Bundle the fee as an instruction in the same transaction, enforced by Turnkey
policy refusing to sign transactions whose parsed instructions lack it. Design the
send path around a single canonical instruction shape from day one, so pinning it
on-chain later is a policy change rather than a rewrite.

## Verified vendor facts

### Privy

| Claim                                                                              | Verdict                            |
| ---------------------------------------------------------------------------------- | ---------------------------------- |
| `signupWithPasskey` creates a user with no email attached, in `@privy-io/expo`     | Confirmed                          |
| Email can be unlinked once another account is linked                               | Confirmed                          |
| Wallet MFA gates every private-key use, enforced server-side                       | Confirmed                          |
| MFA is cached for 15 minutes, so not per-transaction                               | Confirmed                          |
| MFA enrollment is opt-in, with no app-wide force switch                            | Confirmed                          |
| Unenrolling MFA requires completing MFA; no documented email-only reset            | Confirmed                          |
| Session signers bypass MFA by design                                               | Confirmed                          |
| Key export is enabled by default                                                   | Confirmed                          |
| Solana on both `@privy-io/expo` and `@privy-io/react-auth`, same wallet per app ID | Confirmed (last part by inference) |

Must-dos:

- Gate MFA enrollment in our own flow, client and server. A user who skips it is
  not a real signer.
- Ship a DENY policy or a 2-of-2 key quorum on export. Otherwise a compromised
  session exfiltrates the raw Solana key and permanently defeats the quorum for S1.
- Never SMS for MFA.
- Set `shouldUnlinkOnUnenrollMfa: false` (`removeForLogin: false` on Expo), or
  unenrolling the passkey silently unlinks it as a login method.

### Turnkey

| Claim                                                                                                                           | Verdict      |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Passkey-only sub-org: `userEmail` optional, empty `apiKeys` and `oauthProviders`, `rootQuorumThreshold: 1`                      | Confirmed    |
| Email auth and email recovery default **ON** for sub-orgs                                                                       | Confirmed    |
| Turnkey "recovery" means adding email as an auth method                                                                         | Confirmed    |
| Solana policy engine covers recipient, amount, program IDs, instruction count, account allowlists, evaluated in a Nitro Enclave | Confirmed    |
| `SIGN_TRANSACTION` signs externally built Solana transactions with policy evaluation                                            | Confirmed    |
| ed25519 / `ADDRESS_FORMAT_SOLANA`, returned address is the base58 public key                                                    | Confirmed    |
| `@turnkey/react-native-wallet-kit` exists, needs a dev build, passkeys are domain-bound                                         | Confirmed    |
| Behaviour when the transaction already carries another signature                                                                | Undocumented |

Must-dos:

- Pass all four opt-outs at sub-org creation: `disableEmailAuth`,
  `disableOtpEmailAuth`, `disableEmailRecovery`, `disableSmsAuth`. They default to
  on, and omitting them silently ships an email-unlockable S2.
- Use `SIGN_TRANSACTION` with `type: TRANSACTION_TYPE_SOLANA`, never
  `SIGN_RAW_PAYLOAD`, which gets no Solana-aware policy evaluation and makes S2
  decorative.
- Decide policy-update authority before creating the first sub-org. The parent org
  is read-only over sub-orgs and narrowing the root quorum is one-way without the
  end user.
- Use `SIGN_TRANSACTION_V2`. It **preserves** a pre-existing signature, so no
  client-side splicing is needed. Turnkey's own `withFeePayer.ts` example feeds the
  already-signed output of one call into a second, and `broadcast()` does not
  re-sign, so the example can only work if signatures survive. Proven by
  demonstration rather than by written contract, so smoke-test it on devnet against
  a real partially-signed Squads transaction before relying on it.
- Do **not** use Turnkey's shipped React Native stamper. It generates the P-256 key
  in JS, stores it via `react-native-keychain`, and reads it back into memory to
  sign. Software-held and extractable, which forfeits the possession anchor. There
  is no Secure Enclave or StrongBox support anywhere in the SDK.

Accepted consequence: with the opt-outs set, a lost S2 is permanently unrecoverable.
The 2-of-3 absorbs it via S1 plus S3, which makes S3 load-bearing rather than
decorative.

## Runtime verification

Run 2026-08-03 against the **deployed program bytecode**, pulled from devnet
(`BPFLoaderUpgradeable` program data) and executed in LiteSVM with the real
`ProgramConfig` account injected. The devnet faucet was exhausted, so this runs the
same bytecode locally rather than paying for devnet transactions.

| Claim under test                                                               | Result                                                                   |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Create Account: 3 signers, threshold 2, autonomous                             | Passes. Permission masks land as 7 / 6 / 2.                              |
| Account threshold is enforced                                                  | Passes. One signature is rejected against threshold 2.                   |
| A 2-signer spend executes in **one** transaction                               | Passes. S1 plus S2, 23,264 compute units.                                |
| Settings `time_lock` delays settings changes                                   | Passes. Execution blocked before it elapses, allowed after a clock warp. |
| A Policy carries its **own** signer set and threshold                          | Passes. Account is 3 signers at threshold 2; policy is `[S1]` at 1.      |
| A spend executes synchronously under a Policy while the Account is time-locked | Passes. S1 alone, Settings `time_lock` 60, policy `time_lock` 0.         |
| Vote-only S3 is unable to help spend                                           | **Fails.** S1 plus S3 spent successfully through Settings consensus.     |

Two findings changed decisions:

- **Synchronous execution requires `consensus_account.time_lock() == 0`**
  (`TimeLockNotZero`, 6051). See D3. Spends must run under a Policy.
- **Vote-only permissions do not prevent a signer contributing to a spend.** See
  D5b, which is now required rather than an optimization.

**O5 measured:** an Account costs **0.00252452 SOL** to create (2,524,520 lamports),
of which 2,519,520 is rent for the settings account. The creation fee is 0 on both
mainnet and devnet. At 100,000 Accounts that is roughly 252 SOL in rent.

Harness lives in the session scratchpad (`spike/00-fetch-program.js` through
`spike/04-timelock-and-policy-spend.js`). Worth porting into the repo as a test
fixture when the adapter lands.

Still unexercised: rejection and cancellation of a pending settings change during
the time lock, which the notification story in D5b depends on.

## Open

|     | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| O1  | **Resolved: option B.** S2's authenticator is a Secure Enclave (iOS) or Keystore (Android) P-256 key registered as a Turnkey API-key authenticator, biometric-gated. One passkey in the product, genuinely device-bound. Remaining verification: can Turnkey's React Native SDK stamp requests with a hardware-backed key it did not itself generate.                                                                                                                                            |
| O9  | **Resolved: confirmed at runtime.** A Policy carries its own signer set and threshold, and a spend executes synchronously under it while the Account is time-locked. See Runtime verification. Remaining sub-item: rejection and cancellation of a pending settings change during the time lock.                                                                                                                                                                                                 |
| O2  | **Resolved: creation is permissionless.** Squads was unreachable, so this was settled empirically. Mainnet `ProgramConfig` reads `smart_account_creation_fee: 0`, `smart_account_index: 502795`, and the struct carries no whitelist field (`smart_account_index`, `authority`, `smart_account_creation_fee`, `treasury`, `_reserved`). `create_smart_account` validates only that the treasury matches. The source comment about future permissioning is not reflected in the deployed program. |
| O3  | Spending limit band: amount and period.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| O4  | `time_lock` duration on settings changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| O5  | **Resolved: 0.00252452 SOL per Account** (2,524,520 lamports), almost entirely settings-account rent. Creation fee is 0 on mainnet and devnet. Roughly 252 SOL per 100,000 Accounts.                                                                                                                                                                                                                                                                                                             |
| O6  | Turnkey policy-update authority: backend in the root quorum, or `POLICY` granted to a delegated user. One-way at creation.                                                                                                                                                                                                                                                                                                                                                                       |
| O7  | Confirm with Privy in writing: can support manually reset a user's wallet MFA out of band, and does disabling email login app-wide block users who already have email linked.                                                                                                                                                                                                                                                                                                                    |
| O8  | **Provisional, and D4 shifted it.** Categories stay Fuse's: **Active Keys** and **Recovery Keys**. Individually S1 is now unlocked by the passkey alone, so "Sign-in Key" no longer describes it well; **Passkey** is the honest name and is already the `CONTEXT.md` term. S2 is the **Device Key** (Fuse's word, and accurate: it is the phone-bound hardware key). S3 is the **Recovery Key**. Still flagged **to modify**, and still deliberately out of `CONTEXT.md` until the UI exists.   |

## Rejected

| Option                                   | Why                                                                                                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Grid                                     | Already migrated off it to Privy.                                                                                                               |
| Squads V4                                | 3 to 4 transactions per spend, see D1.                                                                                                          |
| Passkey as an on-chain signer            | `SmartAccountSigner.key` is a `Pubkey`, ed25519 only. No secp256r1 anywhere in the program. A passkey can only gate a KMS-held key.             |
| Fuse's iCloud key as an **active** key   | Needed on every spend, so it hard-binds the Account to Apple and Android users cannot spend. Correct as a recovery key, wrong as an active one. |
| Fuse's 1-of-2 default                    | Either key alone moves funds. Two attack surfaces, no threshold.                                                                                |
| Turnkey OAuth for S2                     | Sign in with Google is the same account that owns the Gmail inbox, so it is not an independent anchor.                                          |
| Privy MFA alone, without a second signer | Vendor-enforced, not chain-enforced. A Privy compromise defeats it.                                                                             |
| Relayer as an enforcement point          | A user holding two signers can pay their own fee and submit directly.                                                                           |

## Cleanup

Done on 2026-08-02:

- Removed the vestigial `keypair` and `credentialsBundle` fields from
  `AuthContextType` and `AuthContext` (both were hardcoded `null` and consumed
  nowhere), which dropped the last `@sqds/grid-react-native` import from
  `apps/mobile/types/Auth.ts`.
- Deleted `apps/mobile/docs/authentication.md` and
  `apps/mobile/docs/smart-account.md`, which documented the superseded Grid auth and
  Grid smart-account flows, and removed their links from `apps/mobile/README.md`.
- Corrected the `apps/mobile/README.md` intro (Privy for auth and signing, Grid for
  KYC only) and its stale Expo SDK 54 reference.
- `CONTEXT.md`: Account is a "Squads smart account", `Recovery Email` must differ
  from the sign-in email, and `Recover` is driven by signers rather than by email.

**Grid is not dead and must not be deleted.** `apps/mobile/example.env:1` states
"Grid SDK, still used for KYC only", and `useKyc` is live in `app/(modals)/kyc.tsx`,
`ReceiveModal`, and `SendModal`. `apps/mobile/grid/sdkClient.ts` and the
`app/api/kyc*` routes stay until KYC moves to another provider. An earlier draft of
this document wrongly listed them as dead code.

## Reference

Fuse key explainer screenshots, captured from a live account, in
`docs/design/references/fuse/`. Their Active Key / Recovery Key information
architecture maps onto this signer set without modification.

## Turnkey integration notes

Verified against the published packages' type definitions (`@turnkey/http@5.0.0`,
`@turnkey/core@2.3.0`, `@turnkey/api-key-stamper@0.6.8`,
`@turnkey/react-native-wallet-kit@2.1.0`, `@turnkey/crypto@2.10.1`).

### The stamp we have to produce

| Element        | Value                                                  |
| -------------- | ------------------------------------------------------ |
| Header         | `X-Stamp`                                              |
| Signed content | the exact JSON POST body string, byte for byte         |
| Hash           | SHA-256                                                |
| Signature      | DER-encoded ASN.1 ECDSA, hex                           |
| Public key     | compressed SEC1 hex, 33 bytes / 66 chars               |
| Scheme         | `SIGNATURE_SCHEME_TK_API_P256`                         |
| Envelope       | unpadded base64url of `{publicKey, scheme, signature}` |

Both platforms produce P-256 SHA-256 DER natively, so the algorithms line up with no
conversion. The one mismatch is the public key: Secure Enclave and Keystore hand back
the uncompressed X9.62 point (`04 || X || Y`, 65 bytes), which must be compressed
before registration. `@turnkey/crypto` exports `compressRawPublicKey` for this.

### What has to be built

1. A native module generating a non-exportable, biometric-gated P-256 key in the
   Secure Enclave or Android Keystore and signing arbitrary payloads with it. No
   off-the-shelf package covers this: `react-native-biometrics` uses RSA, and
   `react-native-secure-enclave-operations` returns App Attest CBOR.
2. A `TStamper` implementation, roughly 30 lines, wrapping that native signer.
3. A backend enrolment endpoint. Sub-org creation is a parent-org activity, so the
   parent API key stays server-side. The client generates the key in hardware, sends
   only the compressed public key, the backend creates the sub-org, and then drops
   out of the request path entirely.

### Smoke test before building on it

One `getWhoami` call stamped with a hardware key, to confirm the low-S normalisation
assumption holds. Cheap, and it invalidates the whole approach if wrong.

### The hardware key, and why attestation is not optional

Source-review and simulator-level evidence only. Nothing has run on a physical
device yet.

Recommended base: `@sbaiahmed1/react-native-biometrics@0.15.1` plus roughly 15 lines
of noble conversion for the signature and public-key encoding.

Three properties the design leans on that **the client cannot prove**:

1. **The simulator silently fakes the Secure Enclave.** `SecKeyCreateRandomKey` with
   `kSecAttrTokenIDSecureEnclave` succeeds on current simulators against a host-side
   software implementation. A key blob generated in one simulator restores in a
   different simulator with a different UDID and yields the same public key, and the
   blob is 143 bytes against 284 from a real SEP. Apple DTS confirms the simulator
   "acts like an iOS device that has no SE". At the JS layer a simulator key is
   indistinguishable from a real one.
2. **StrongBox falls back to TEE silently** on Android.
3. **Per-use biometric gating is not guaranteed on iOS.** Retaining an `LAContext`
   and passing it via `kSecUseAuthenticationContext` can collapse prompts across
   operations, and Apple has never confirmed or denied the behaviour. Construct a
   fresh `LAContext` at every call site and never cache the `SecKey`, but treat the
   prompt as a UX affordance rather than the security boundary.

So two things are **required**, not nice-to-have:

- **Attestation at registration.** App Attest on iOS, the Keystore attestation chain
  on Android. The backend must refuse any enrolment it cannot prove is
  hardware-backed, or a simulator stub enrols as S2 and the possession anchor is
  fiction.
- **Server-side nonce, short expiry, and rate limiting per signature**, so that a
  collapsed biometric prompt cannot become an unbounded signing oracle.

Two smaller correctness notes:

- Keychain survival across app uninstall is explicitly not part of Apple's API
  contract and has flipped between releases. Depend on neither survival nor
  deletion: keep a first-run sentinel in `NSUserDefaults`, which _is_ cleared on
  uninstall, and delete a stale key before enrolling when the sentinel is missing
  but a key alias exists.
- Removing the device passcode discards the class keys, leaving
  `WhenPasscodeSetThisDeviceOnly` items present but undecryptable. Handle an auth or
  decryption failure on lookup exactly like `errSecItemNotFound`: re-enroll rather
  than retry.

## The recovery signer, and the problem with D10b

Source review only. Nothing verified on a physical device.

### Recommended storage

| Platform | Mechanism                                                                                                                                       | Notes                                                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| iOS      | Synchronizable keychain item: `kSecClassGenericPassword`, `kSecAttrSynchronizable`, `kSecAttrAccessibleAfterFirstUnlock`, **no** access control | Zero entitlements, works on a free team, E2EE by default. Write two items, one synced and one `ThisDeviceOnly`, and read cloud-first. |
| Android  | Block Store with `setShouldBackupToCloud(true)`, gated on `isEndToEndEncryptionAvailable()`                                                     | Not sufficient alone. Pair it with Drive `appDataFolder` as a **verifiable** second write behind one Google consent.                  |

Library: `react-native-sensitive-info@6.1.5` with `iosSynchronizable: true` and an
explicit `accessControl: 'none'`. Not `react-native-keychain`, which has an unfixed
Objective-C truthiness bug where passing `cloudSync: false` sets
`kSecAttrSynchronizable` to **true**, plus unreleased TurboModule work against RN
0.85. On Android, vendor the roughly 60 lines of Block Store rather than depending on
`expo-block-store` (one author, one star). Budget **1024 bytes** for key and value
combined, not the 4096 the guide claims: the API constant disagrees with the docs.

Encrypt the S3 key with AES-GCM under a key we derive **before** it leaves our code.
Every mature wallet does this. A platform-store compromise should not immediately be
a signer compromise.

### The finding that undermines D10b

**Neither platform gives a read receipt.** An iOS keychain write returns success for
the _local_ item and sync is asynchronous with unbounded latency and no
`synchronize()`. Block Store's `storeBytes` success means stored locally in Play
Services; the cloud push is periodic. There is also **no API to ask whether iCloud
Keychain is enabled**, so a user who has it off gets a silent non-backup with no
error.

D10b makes S3 mandatory at Account creation, and the lost-phone path is explicitly
S1 plus S3. But S3 can only ever be **provisioned, not confirmed**. That is a real
gap between what the decision assumes and what the platforms provide.

**Resolved, and rewritten after the checkout requirement landed.**

The original plan put S3 in the platform store, silently, at Account creation. That is
now wrong for two independent reasons. It shares an anchor with the passkey, and it
does not survive the case `CONTEXT.md` explicitly names: **switching from iPhone to
Android**. Passkeys do not cross from Apple to Google and neither does an iCloud blob,
so an Apple ID change would take out S1 and S3 together and leave one signer with no
way back.

So S3 moves off the device and off the platform account entirely:

**At signup we generate a spare key, encrypt it, and hold it server-side. The Consumer
never sees it. Using it requires proving control of their email.**

| Event                             | S1 passkey | S2 phone | S3           |
| --------------------------------- | ---------- | -------- | ------------ |
| Lost phone, same platform account | survives   | gone     | survives     |
| Switched iPhone to Android        | gone       | gone     | **survives** |
| Inbox compromised                 | safe       | safe     | reachable    |
| Platform account compromised      | reachable  | safe     | safe         |

Properties this buys:

- Silent at creation. No screen, no seed phrase, nothing to write down.
- Survives both a lost phone and a platform-account change.
- Xend alone cannot use it, because it needs the email step.
- Even with the email it **cannot spend**. D5b keeps recovery signers out of every
  spend path, so the most it can do is participate in a settings change, which is
  time-locked and notified.

Honest characterisation: this is the Argent pattern, where the provider holds an
encrypted recovery secret released against a second factor. It is not pure
self-custody. Xend holds one of three signers and the weakest one, and cannot reach
threshold alone.

The alternative is a **third KMS vendor** with email auth holding it instead of us,
which reads better commercially ("we hold none of your keys") at the cost of running a
third vendor. It cannot be Privy or Turnkey, since either holding two signers could
reach threshold alone. The security property is identical either way, so ship ours and
swap later if custody becomes a commercial issue.

Onboarding is therefore three steps: passkey, then the silent Turnkey and S3
provisioning, then one screen asking for **their email**. Not "a recovery email", just
their email. Additional recovery signers (another email, an external wallet) stay
available later in settings for anyone who wants them.

Rejected, unchanged: an encrypted cloud **file** under a user-held secret, the
Uniswap / Coinbase Wallet / BRD / Argent / Dynamic pattern. Verifiable, but it costs a
consent screen and a secret to remember, reintroducing the "write this down" moment
the product exists to avoid.

### One real issue in the repo, and one false alarm

**Real: `expo-secure-store` never sets `kSecAttrSynchronizable`.** Verified directly
against the installed package: the attribute appears nowhere in its iOS sources, and
an Expo maintainer confirms iCloud keychain syncing is not implemented. So anything
written through it **does not survive device loss**. Fine for a device-scoped cache,
fatal for anything the recovery story leans on, so S3 cannot use it.

**False alarm: Android backup.** Research flagged `android:allowBackup="true"` as
shipping a restore that produces undecryptable ciphertext, since Android
`expo-secure-store` is SharedPreferences wrapped by a non-exportable Keystore key.
Correct as generic Android advice, wrong here. `expo-secure-store` ships its own
library-level exclusions, already merged into our manifest via
`android:fullBackupContent="@xml/secure_store_backup_rules"` and
`android:dataExtractionRules="@xml/secure_store_data_extraction_rules"`. Both exclude
`sharedpref` path `SecureStore` from cloud backup and device transfer. No change
needed. Recorded so nobody re-raises it.

### Open question this raises about S1

Privy's current published architecture is 2-of-2 with **both** shares server-side and
no device share; the 2-of-3 model with a device share is legacy. Which one
`@privy-io/expo` uses on our stack is undocumented. If a device share exists and is
synced through iCloud Keychain, S1 and S3 would share the platform-account anchor and
the invariant breaks. Worth asking Privy directly, along with which Drive scope their
cloud recovery uses.

## What comparable products actually default to

Surveyed for O3 and O4: Squads, Safe, Coinbase Smart Wallet (Base Account), Braavos,
Ambire, Clave, Soul Wallet, Candide, Sequence, Rainbow, Ledger, MetaMask, Privy,
Turnkey.

### Spending limits (O3)

**Not one ships a default per-period limit on ordinary transfers.** Every
spending-limit feature found is opt-in and absent until explicitly configured, and
the developer platforms (Privy, Turnkey) default to deny-all rather than to a
threshold. Squads is no exception: `amount` is caller-supplied and the invariant
rejects zero, so there is no default to inherit.

So defaulting a limit **on** is a deliberate departure. It is still the right call for
a payments app, where the dominant case is a small P2P Send and a second factor on a
$6 payment would destroy the product, but we are not following a precedent here.

| Product                 | Shape                                                                                                                                                                                    | Default                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Braavos                 | Two thresholds. Below the Low Limit a weak signer alone; below the High Limit a strong (secure-enclave or passkey) signer alone; above, full multisig. 24-hour window, USDC-denominated. | Off. No published amount.                           |
| Safe                    | Allowance Module, per-delegate. UI offers One time / 1 day / 1 week / 1 month. `resetTimeMin` is `uint16` minutes, so ~45.5 days is the ceiling.                                         | Off. Form opens on "One time" with an empty amount. |
| Coinbase / Base Account | Spend Permissions, app-requested and user-approved, `period` in seconds. Unused allowance does not roll over.                                                                            | No wallet-wide cap.                                 |
| Everyone else           | opt-in or absent                                                                                                                                                                         | none                                                |

Braavos is the closest architectural match to ours and is worth reading directly.

Two implementation details taken from the survey:

- **A stronger-signer spend must not consume the limit.** Braavos does this
  explicitly: if a transaction is validated with a stronger signer than the limit
  required, its value is not accumulated. We get this free, because an above-limit
  Spend runs under a different policy and never touches the spending-limit policy's
  counter. Worth stating so nobody "fixes" it later.
- **Unused allowance does not roll over.** Coinbase is explicit; we already set
  `accumulateUnused: false`.

### Delay on security-configuration changes (O4)

Here there **is** a clear industry number, and it is not ours.

| Product | Delay                                           | Notes                                      |
| ------- | ----------------------------------------------- | ------------------------------------------ |
| Braavos | **4 days** (`ACCOUNT_DEFAULT_ETD_SEC = 345600`) | min 1 day, max 365                         |
| Ambire  | **3 days**                                      | recovery timelock                          |
| Candide | **3 days**                                      | 7 and 14 day module variants also deployed |

Convergence at 3 to 4 days. Our current `SETTINGS_TIME_LOCK_SECONDS` is 24 hours.

Argument against simply matching them: all three are self-custody wallets where every
action is deliberate. We are a payments app, and S2 is deliberately unrecoverable, so
replacing a lost phone requires a settings change. Four days before a Consumer's new
phone works is not a payments experience.

Note also what the delay defends: an attacker holding S1 plus S3 rotating S2 out. A
Consumer who has genuinely lost their phone cannot reject anyway, so the window only
helps where they still hold S2. That argues for the shorter end.

Neither Safe nor Coinbase uses a delay as a step-up at all; both are binary, one
signature within the limit and the normal authorisation path above it.

### The requirement this exposes

**A time lock is worthless without a notification.** If a pending settings change sits
for a day and the Consumer never hears about it, the delay protects nobody. Push
notification on any pending settings change, with a one-tap reject, is therefore a
hard requirement of D3 rather than a nice-to-have.

## Privy internals, verified against shipped code

Read directly from the installed packages and from 0.70.6 packed off npm. Both
identical on every point.

### The anchor question: answered, and the answer is good

**Privy's device share cannot reach iCloud Keychain.** Three independent reasons:

1. `kSecAttrSynchronizable` appears **nowhere** in `expo-secure-store@56.0.4`.
2. Privy writes with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, and Apple documents that
   a `ThisDeviceOnly` accessibility class **cannot** be combined with syncing. So it
   is structurally impossible, not merely unset.
3. `kSecAttrAccessGroup` is only set when the caller passes one; Privy does not.

Android is equally clean: ciphertext in `shared_prefs/SecureStore.xml` under a
non-exportable AndroidKeyStore key, excluded from both cloud backup and device
transfer, and **nothing** is ever written through Block Store.

**So S1 and S3 do not share an anchor, and the invariant holds.**

Correction to our own wording elsewhere: `ThisDeviceOnly` items are **not excluded
from iOS backups**. They are copied in, wrapped to the source device's hardware UID,
so they are useless on another device but present in the blob. Only
`WhenPasscodeSetThisDeviceOnly` is literally excluded.

### The passkey must be the login method, and must sync

An earlier draft of this section recommended `removeForLogin: true` to demote the
passkey to MFA only, on the grounds that a passkey-as-login makes the phone S1's
anchor. **That recommendation is withdrawn.** It would break checkout, which is the
product.

The reasoning that produced it was not wrong, only incomplete: a passkey that is
sufficient for login does make the platform account S1's anchor. The correct response
is not to weaken the passkey, it is to move S3 off that anchor, which D4 now does.

Two properties the passkey must keep, both essential rather than incidental:

- **It syncs.** iCloud Keychain and Google Password Manager. Without this a Consumer
  cannot check out on a laptop without re-enrolling, which is the friction the product
  exists to remove.
- **It is sufficient on its own.** Tapping "Pay with Xend" on a merchant page prompts
  the passkey and nothing else.

What still holds from the storage research: Privy's own device share never syncs
(`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, and `kSecAttrSynchronizable`
appears nowhere in `expo-secure-store`), Android is AndroidKeyStore-wrapped and
excluded from backup, and nothing touches Block Store. Those are separate artefacts
from the passkey and none of it constrains the passkey's syncing.

Still to lock down:

- Confirm the execution mode (Dashboard, Wallets, Advanced) or assert on
  `recovery_method` at runtime.
- **Never enable Privy's iCloud or Google Drive recovery.** It is the one Privy
  feature that would put wallet key material under the Apple ID via CloudKit,
  alongside the passkey. Currently blocked three ways by accident, so assert it
  explicitly.

### O7 resolved: there is no out-of-band MFA reset

No server SDK method (`mfa` appears zero times in `@privy-io/server-auth`), no REST
endpoint among 72 app-secret routes, no dashboard control, and MFA survives disabling
the feature app-wide. Deleting the user is not a workaround: it destroys the wallet
address, and Privy's own words on recovering a soft-deleted wallet are "no guarantee
of successful recovery".

The useful corollary: **nobody, not Privy support and not us, can strip a Consumer's
wallet MFA to hijack S1.** Wallet MFA introduces no hidden second anchor, which
strengthens the model rather than weakening it.

The symmetric cost: a Consumer who loses their MFA factor loses S1 permanently. The
2-of-3 absorbs it via S2 plus S3, but **that recovery path must work without S1**, and
it is the one that will actually be exercised. Verify it end to end.

Residual unknown, stated rather than hidden: Privy hints at an internal capability
("requires significant internal coordination"). It does not matter to the design.
Whatever Privy can do internally, Privy controls **one** of three signers and cannot
reach threshold alone. That property is what makes this hold, not any assumption about
Privy's internal controls.

## O3 resolved: the spending limit band

The crypto survey gave nothing (14 products, no defaults). Mainstream payments and the
SCA regulations do, and they converge.

### A framing correction first

**A hardware key on the phone is not a step-up in the regulatory sense. It is
authentication.** The FCA states it directly: digital wallets can be used "above the
contactless payment limits without the need to enter a PIN... because they already
apply SCA by design". So the band we are choosing governs the **un-stepped-up path
only**, and the right analogue is the contactless exemption, not the identity gates
Venmo and Cash App use.

That distinction changes the number. Venmo's $300 and Cash App's $1,000 gate a
one-time, SSN-grade identity check, so they must sit high enough not to block normal
users. A hardware-key tap is repeatable and near-free, so it belongs where contactless
PIN prompts sit.

### The convergence

| Source                                                  | Single                                                                                        | Cumulative                | Ratio |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------- | ----- |
| EU RTS Art. 11 (in force)                               | EUR 50                                                                                        | EUR 150, or 5 consecutive | 3:1   |
| UK (2021 to Mar 2026)                                   | GBP 100                                                                                       | GBP 300, or 5 consecutive | 3:1   |
| UK industry, asked where it belongs given total freedom | GBP 100 "covers the value of most in-person transactions"; those wanting more said 150 to 250 | 450 to 600                | ~3:1  |
| Venmo step-up                                           |                                                                                               | $300 per rolling 7 days   |       |

US average debit card payment is **$41**, credit **$97** (Federal Reserve Payments
Study, CY2024). A $100 per-transaction ceiling sits above the mean of both.

### Decision

**US: $100 per transaction, $300 cumulative, or 5 consecutive Spends.**
**Nigeria: NGN 200,000 per rolling 24 hours.**

The Nigerian figure is not invented. CBN's NIP authentication ladder
(BPS/DIR/GEN/CIR/01/011) sets NGN 200,000 as the daily ceiling for OTP-grade
authentication and reserves NGN 500,000 and NGN 1,000,000 for hardware-token-grade. A
phone-resident hardware key is exactly the factor CBN expects at that boundary, so we
are taking the conservative end of the band our control qualifies for.

**The assumption most worth resolving before shipping in Nigeria:** this rests on our
un-stepped path (passkey plus device) counting as two-factor. If a regulator reads it
as one factor, CBN's analogue is the Low Security tier at **NGN 20,000 per day**, a
tenfold difference.

### The structural finding we cannot fully use

Regulators do not use a calendar period. They use **"since the last application of
strong customer authentication"**, which self-resets on every step-up. An active
Consumer who authenticates often is never throttled; a compromised device burns a
bounded amount and stops. No calendar or rolling window has that property, and none of
the 14 wallets surveyed has it.

**Squads cannot express it cheaply.** `SpendingLimit` resets on time
(`period`, `last_reset`), and resetting `UsageState` on demand means a policy update,
which is a settings change behind threshold 2 and the time lock. So we take the
time-based period and note the gap.

Partial consolation, and it is real: a stepped-up Spend runs under the above-limit
policy and therefore **never touches the spending-limit counter**. So authenticating
does not consume the allowance, which is the more important half of the property.

### Two implementation rules taken from custodial exchanges

- **Require the hardware key to disable or raise the limit.** Coinbase requires 48
  hours to disable allowlisting; Gemini requires the 7-day hold to remove the 7-day
  hold. A limit you can switch off with the factor it protects is not a limit.
- **Do not let support waive it.** Kraken states this twice. It is the control that
  actually resists social engineering.

## Decision: new-recipient step-up

Destination novelty is a better trigger than amount alone, and the evidence is
stronger for it. It is the only new-payment friction any regulator mandates (UK
Confirmation of Payee on new-payee setup, EU Verification of Payee on every transfer),
and every serious custodial exchange has converged on it independently. Amount-based
limits are meanwhile being dismantled: the FCA removed the UK's regulatory contactless
limits outright on **19 March 2026** in favour of firm-set risk-based judgement.

**So: require the hardware key on the first Spend to any new Address, regardless of
amount. Remember the Address afterwards, and subsequent Spends fall back under the
band.**

**A step-up, never a delay.** The exchanges use 24 to 72 hour holds, which would
destroy a product whose dominant case is a P2P Send to a friend. Wells Fargo has the
right shape: a second factor on the first send to a payee, not a timer.

Two refinements worth taking:

- **Treat profile mutation as newness.** Citi's "untenured" definition resets on a
  changed phone number, email, or linked account. A changed signer set should reset it
  too.
- Consider exempting a first Spend below roughly $20. Test-sends to a new address are
  a near-universal habit, and forcing a hardware key on a $1 test trains Consumers to
  resent the control.

## Compliance: a Nigerian rule that may conflict with the design

CBN PSP/DIR/PUB/CIR/001/001, 12 March 2026, **effective 1 July 2026**:

- A **NGN 20,000 cap on all inflow and outflow in the first 24 hours** after app
  activation, both for a new account **and for an existing account on a new device**.
- **Mandatory device binding**: the app "shall only be enabled on one device at a
  time", and migrating devices "shall trigger automatic re-activation and
  authentication".
- Online account opening and reactivation require a liveliness check plus real-time
  BVN/NIN validation.

The first-24-hours cap is straightforward to implement. **The device-binding clause is
not, and it points at the centre of the design.** Checkout is deliberately
multi-device: the passkey syncs precisely so a Consumer can pay from a laptop without
re-enrolling. One-device-at-a-time is in tension with that.

Open question, and it needs a legal read rather than an engineering one: whether a web
checkout on a laptop counts as "the app" for the purposes of this circular. If it
does, the Nigerian flow needs to diverge from the US one. Do not assume it does not.

## D10c. An Account always keeps at least one recovery signer

Fuse's rule, adopted. The sole recovery signer can be **rotated** but never
**removed**. Adding a second is what unlocks removing the first.

The reason is structural rather than cautious: S2 is deliberately unrecoverable, so
a lost phone is recovered with S1 plus a recovery signer. An Account with zero
recovery signers turns a lost phone from an inconvenience into permanent loss of
funds, and it can reach that state through one settings screen.

- **Sole signer**: `removable: false`. Change the email, do not delete the signer.
- **Two or more**: all removable.
- **Rotation mints a fresh keypair**, never a new address on the old secret. The
  usual reason to change a recovery email is that the old one was compromised.
- Removal returns the removed address, because the database and the on-chain signer
  set have to change together. Deleting the row without the settings change leaves
  them disagreeing.

Enforced in `RecoveryService`, not in the database. The rule is about intent rather
than referential integrity, and a SQL constraint would fire on the wrong side of the
on-chain settings change.

Built in `apps/backend/src/recovery/`, migration `0010_recovery_signers.sql`.

### On the vault seam

`RecoveryVault` seals and opens the recovery secret, with an env-key AES-256-GCM
implementation at the pilot floor and a `keyId` on every sealed key so the custody
order (KMS > cloud-KMS > raw env) is a migration rather than a rewrite. Same posture
as the settlement authority signer.

Be precise about what it buys: **Xend can open a sealed key**, so this is an
operational control, not a cryptographic impossibility. The guarantee is that opening
requires an email-verified session and is auditable, not that Xend is unable to. The
property the design actually rests on is elsewhere, in the threshold: this signer is
one of three, and D5b keeps it out of every spend path.
