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

**Constraint discovered at runtime.** `validate_synchronous_consensus` requires
`consensus_account.time_lock() == 0`, or it throws `TimeLockNotZero` (6051). A
non-zero time lock on the Settings therefore blocks synchronous execution _through
the Settings_. The check is against whichever consensus account is used, and a
Policy is itself a consensus account with its own `time_lock`, so:

- Settings `time_lock` non-zero, governing settings changes only
- Policy `time_lock` 0, so everyday spends stay synchronous

**Every spend must therefore execute under a Policy, never under the Settings
consensus.** Verified end to end (see Runtime verification).

### D4. The signer set

|             | S1                            | S2                                                  | S3                              |
| ----------- | ----------------------------- | --------------------------------------------------- | ------------------------------- |
| Anchor      | email inbox                   | physical possession                                 | platform account                |
| Key holder  | Privy                         | Turnkey                                             | encrypted blob, platform-stored |
| Unlock      | email OTP plus passkey MFA    | biometric-gated hardware key on the phone           | Apple ID or Google account      |
| Permissions | `Initiate \| Vote \| Execute` | `Vote \| Execute`                                   | `Vote`                          |
| Present     | every spend                   | above the spending limit, and every settings change | recovery only                   |

S1 stays anchored to email rather than going passkey-first (which Privy does
support via `signupWithPasskey`) because S1 must work on a laptop for everyday
spends, and S1 alone can never exceed the spending limit. The possession factor
sits on S2, which is what Fuse gets from its Secure Enclave device key.

### D5. Spending limit carries the everyday UX

A spending limit assigned to S1 covering the everyday band. Inside it, a spend is
one instruction and one signature. Outside it, execution escalates to
`transaction_execute_sync` with S1 plus S2.

The band must be set so typical checkout payments fall inside it. Amount and period
are **Open**.

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

Confidence: the `Policy` fields and the `ConsensusAccountType::Policy` branch are
read directly from program source. Rejection and cancellation semantics during a
time lock need a devnet spike before we lean on them. Tracked as O9.

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

**Shared-anchor rule, relaxed by D5b.** S3 sharing an anchor with S1 (a Gmail user
backing up to Google Block Store) was previously fatal. Under D5b, S3 cannot
participate in spending at all, so that pair can only start a time-locked settings
change that the Consumer is notified about and S2 can reject. Platform backup is
therefore offered to everyone rather than pushing Gmail-on-Android users to a second
email address. Prefer a different provider where the platform makes it free (iCloud
for a Gmail user on iOS), but do not block on it.

This relaxation depends entirely on D5b holding. If the devnet spike (O9) shows
policy-scoped consensus does not work as read, the strict rule comes back.

`CONTEXT.md` line 28 currently says the signup email "also counts as a recovery
channel". That is now a security bug and must change.

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
- Plan on extracting Turnkey's 64-byte signature and splicing it with web3.js
  `addSignature` rather than assuming foreign signatures survive.

Accepted consequence: with the opt-outs set, a lost S2 is permanently unrecoverable.
The 2-of-3 absorbs it via S1 plus S3, which makes S3 load-bearing rather than
decorative.

## Open

|     | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| O1  | **Resolved: option B.** S2's authenticator is a Secure Enclave (iOS) or Keystore (Android) P-256 key registered as a Turnkey API-key authenticator, biometric-gated. One passkey in the product, genuinely device-bound. Remaining verification: can Turnkey's React Native SDK stamp requests with a hardware-backed key it did not itself generate.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| O9  | **Mechanism confirmed, runtime not yet exercised.** Four independent confirmations that a policy carries its own consensus: the `Policy` struct has `signers` and `threshold`; `Consensus` is implemented for both `Settings` and `Policy` with a `ConsensusAccountType::Policy` branch in sync execution; the SDK's `executePolicyPayloadSync` passes `consensusAccount: policy`; and `SettingsAction::PolicyCreate` takes its own `signers`, `threshold`, `timeLock`, `startTimestamp`, `expirationArgs`, with `PolicyUpdate` able to change them later. Still to run: an end-to-end execution, plus rejection and cancellation semantics during a time lock. Harness is built and ready (deployed ELF pulled off devnet, LiteSVM installed) since the devnet faucet is exhausted for this IP. |
| O2  | **Resolved: creation is permissionless.** Squads was unreachable, so this was settled empirically. Mainnet `ProgramConfig` reads `smart_account_creation_fee: 0`, `smart_account_index: 502795`, and the struct carries no whitelist field (`smart_account_index`, `authority`, `smart_account_creation_fee`, `treasury`, `_reserved`). `create_smart_account` validates only that the treasury matches. The source comment about future permissioning is not reflected in the deployed program.                                                                                                                                                                                                                                                                                                 |
| O3  | Spending limit band: amount and period.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| O4  | `time_lock` duration on settings changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| O5  | Per-account cost: creation fee plus rent, against gasless economics.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| O6  | Turnkey policy-update authority: backend in the root quorum, or `POLICY` granted to a delegated user. One-way at creation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| O7  | Confirm with Privy in writing: can support manually reset a user's wallet MFA out of band, and does disabling email login app-wide block users who already have email linked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| O8  | Naming for the UI. Fuse's Active Key / Recovery Key split works and carries no crypto vocabulary. Individual names belong in `CONTEXT.md`'s Language section.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

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
