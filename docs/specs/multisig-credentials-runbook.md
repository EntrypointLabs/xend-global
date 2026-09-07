# Multisig: what only a human can do

Everything in ADR 0025 that cannot be written as code, in the order it has to
happen. Each step is a checklist item, not a research task: the decisions behind
them are already made and recorded in
[`account-security-model-decisions.md`](account-security-model-decisions.md).

## 1. Generate the recovery vault key

Seals the recovery signer's secret (S3). Thirty-two random bytes, base64.

```sh
openssl rand -base64 32
```

Set as `RECOVERY_VAULT_KEY`. Without it the backend still boots and serves
everything else; recovery is the only thing that fails, and it fails at the call
rather than at startup.

**Losing this key loses every sealed recovery signer.** It is the one secret here
with no vendor-side copy. Sealed keys carry a `keyId`, so moving to cloud KMS
later is a migration rather than a rewrite.

## 2. Create the Turnkey organization

Sign up, create the parent organization, and generate an API key pair for it.

| Variable                       | What it is                                     |
| ------------------------------ | ---------------------------------------------- |
| `TURNKEY_ORGANIZATION_ID`      | The parent organization                        |
| `TURNKEY_API_PUBLIC_KEY`       | Parent API key, public half                    |
| `TURNKEY_API_PRIVATE_KEY`      | Parent API key, private half. Server-side only |
| `TURNKEY_DELEGATED_PUBLIC_KEY` | The backend's own P-256 public key             |
| `TURNKEY_API_BASE_URL`         | Only to point at Turnkey staging               |

The delegated key is a second, separate P-256 keypair the backend owns, and its
private half signs every activity scoped to a Consumer's sub-organization. The
parent key cannot: a parent organization is read-only over its sub-orgs, so its
signature carries no authority inside one.

```sh
cd apps/backend
node scripts/generate-turnkey-delegated-key.mjs
```

**Generate it once and never regenerate it.** The public half is registered as a
root user in every sub-organization at creation, so a new keypair would have no
authority in any Account that already exists: their policies could never be
updated again. It is a long-lived secret, not a rotating one.

### 2a. Before the first production sub-organization: one smoke test

**This is the only step here that cannot be undone.** O6 chose a delegated
`POLICY` user over root-quorum membership because a root-quorum member can
register its own authenticator on the S2 wallet, and the backend already holds
S3, so one compromise would reach threshold.

That reasoning follows Turnkey's documented model but has not been exercised
against their API. Settle it on a throwaway sub-organization:

```sh
cd apps/backend
node --env-file=.env scripts/smoke-test-o6.mjs
```

It creates a sub-org with the backend key in the root quorum, tries to add an
API key to the _other_ root user signed only by that key, and deletes the
sub-org either way. No Consumer is involved and nothing production is touched.

- **Succeeds** — O6 stands as decided. Nothing changes; the adapter already
  narrows the backend out of the quorum at enrolment.
- **Fails** — root-quorum membership is less dangerous than assumed, and O6 is
  worth reopening on the merits before any real Consumer exists.

**Run on 2026-08-10: it succeeded.** A root-quorum member can mint an
authenticator on another user, so O6 stands and this step is done. Re-run it only
if Turnkey changes its permission model.

Widening a root quorum later needs the end user's approval. Narrowing is
unilateral. So this is decided once, per Consumer, forever.

### 2b. The signature question, settled

Nothing to do here. This was an open item and the docs closed it.

The send path used to assume `SIGN_TRANSACTION_V2` preserves a signature already
on the transaction, which would let S1 sign first and S2 add to it. It does not
promise that. The activity is specified as unsigned payload in, signed
transaction out, and Turnkey ships a separate `addSignature` precisely because
this one is not additive.

`addSignature` is not the escape hatch: it skips the Policy Engine entirely.
Reaching for it would leave S2 producing a signature no policy ever evaluated,
which is the whole reason S2 exists.

So the order is now S2 first, S1 second. Turnkey's policy sees the clean payload
it is being asked to approve, and the primary fills its own signature slot
afterwards via web3.js, whose `sign()` writes only its own index and leaves the
rest of the array intact. That is a defined library behaviour rather than an
undocumented vendor one, which is the point of the swap.

Turnkey's docs also state one Turnkey signer per transaction. That appears in
the sponsored/fee-payer context and does not bind us: only S2 is a Turnkey
signer here.

## 3. Ask Privy two questions in writing

Recorded as O7, and both change the recovery story if the answer is no:

1. Can Privy support manually reset a user's wallet MFA out of band?
2. Does disabling email login app-wide block users who already have email linked?

## 4. Fund the settlement authority

Account creation costs **0.00252452 SOL** each, almost entirely rent on the
settings account, with a zero creation fee. Roughly 252 SOL per 100,000
Accounts.

The settlement authority pays, not the relayer: the relayer's allowlist
deliberately excludes the System program, so it cannot pay for something whose
cost is rent. The authority already owns the ops paths that need System, so this
adds no new key.

## 5. Apply the migration

`apps/backend/drizzle/0011_squads_accounts.sql`. Defensive, so a re-run is a
no-op.

## What is already done in code

| Piece                                | Where                         |
| ------------------------------------ | ----------------------------- |
| Address derivation, policies, spends | `packages/smart-account`      |
| Verified against deployed bytecode   | `packages/smart-account/test` |
| Recovery signer (S3), sealed at rest | `apps/backend/src/recovery`   |
| Approval signer enrolment (S2)       | `apps/backend/src/turnkey`    |
| Account creation, 2-of-3             | `apps/backend/src/account`    |

## What is still code, not credentials

These do not need anything from a vendor and are tracked separately: the
enrolment endpoint with hardware attestation, the device hardware key and its
stamper, routing the send path through policy spends, pointing receive and
balance at the vault, and sweeping the existing Privy balances across.

## 6. Build a dev client and verify on a physical device

The native key module (`apps/mobile/modules/hardware-key`) is written but has
never run on hardware, and it cannot be verified anywhere else. That is not
caution, it is the design: the iOS simulator satisfies
`kSecAttrTokenIDSecureEnclave` against a host-side software implementation and
returns a key indistinguishable from a real one at the JS layer, and Android
falls back from StrongBox to the TEE silently. A green run on a simulator would
prove nothing.

```sh
cd apps/mobile
npx expo prebuild        # picks up modules/hardware-key
eas build --profile development --platform ios      # and android
```

Then on a real phone, in order:

1. **Enrolment.** Sign in and watch for `attestation.verified` in the backend
   log. `security` must read `secure_enclave` or `strongbox`, and `tee` is
   acceptable. Anything else, or a rejection, means the key is not where it
   needs to be.
2. **Biometric prompt on every signature.** Sign twice in a row. Two prompts.
   One prompt for two signatures means the `LAContext` is being reused and the
   possession factor is weaker than it looks.
3. **A Spend above the limit.** Provisioning installs a US $100 daily limit
   (ADR 0032), so a Spend over it takes the two-signature route and proves the
   Turnkey stamp; one under it proves the passkey path alone.
4. **Low-S.** If Turnkey rejects a stamp as an invalid signature, the
   normalisation in `modules/hardware-key/src/lowS.ts` is the first place to
   look. It is unit tested, but only against synthetic signatures.

## 7. The spending limit, and the 24-hour wait

Provisioning creates the spending-limit policy and the above-limit policy in the
same settings change that sets the time lock (`ProvisioningService`, ADR 0033),
while the lock is still zero, so a Consumer has a limit from the first minute. The
terms are fixed in `apps/backend/src/account/spending-limit.terms.ts` (ADR 0032).

Changing them on an existing Account is a settings change under the 24-hour lock,
and no endpoint or screen drives it yet. Until one exists, `read-spending-limit.ts`
under `apps/backend/scripts/` is the only way to inspect a live limit.

## 8. Compromise report: freeze S3's release first

The first step when a Consumer reports an inbox or passkey compromise, before
anything is investigated. It is mandatory because a single remaining signer cannot
reject a staged change (the rejection cutoff is two signers; see D3 in the decisions
spec), so the only lever that stops an attacker who holds one signer and is fishing
for S3's vote is withholding that vote.

1. Open the console at `/console/accounts`, find the Account by its contact email,
   and press **Freeze**. This sets `users.recovery_release_frozen_at`
   (`RecoveryService.freezeRelease`) and every path that would open the vault for
   S3 (a device rotation, a passkey rotation, a recovery-key change that needs
   S3's vote) refuses with `RecoveryReleaseFrozenError` from that moment.
2. Check `/account/changes/pending` for the Account. If a change is staged, note
   its index and executable time. A Consumer who still holds their passkey and
   phone can reject it themselves (S2 then S1); a Consumer holding only one signer
   cannot, and the freeze is what keeps the change from reaching two approvals.
3. Verify the Consumer out of band, then either help them rotate the compromised
   anchor with their own two signers, or leave the freeze in place until the
   staged change expires or is rejected.
4. Press **Release** only after the report is closed. A frozen Account cannot be
   recovered onto a new phone, so leaving it frozen after the fact strands a
   Consumer who later loses their phone.

The freeze never touches a change approved by S1 and S2 together
(`apps/backend/src/account/release-freeze.spec.ts`), because S3 is never asked. It
is a refusal to sign, not a power to sign, and it is logged at `warn` on both
transitions.

## 9. Move the three signing keys to KMS

Every server key starts life as a raw environment value, which is the pilot
floor and not where any of them should sit for a mainnet run. Three keys move,
each behind its own provider switch, so they can move one at a time.

The wrapping is envelope encryption rather than KMS signing: KMS does not sign
ed25519, so the secret is decrypted into process memory at boot and the key
never leaves the account it was created in.

**Create one KMS key per environment.** Symmetric, encrypt and decrypt usage,
with a key policy that grants `kms:Decrypt` to the backend's role and
`kms:GenerateDataKey` as well for the recovery vault. Note the ARN.

**Encrypt each secret.** The script reads from stdin so nothing lands in shell
history:

```
printf '%s' "$SECRET" | npm --workspace @xend/backend exec \
  tsx scripts/kms-encrypt-secret.ts -- --key-id <arn> --region <region>
```

**Set the switches**, one service at a time, verifying each before the next:

| Key                  | Switch                                                             | Ciphertext                                                                          |
| -------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Recovery vault       | `RECOVERY_VAULT_PROVIDER=aws-kms` plus `RECOVERY_VAULT_KMS_KEY_ID` | Per row, generated on each seal. Existing rows keep opening under their own key id. |
| Settlement authority | `SETTLEMENT_AUTHORITY_PROVIDER=aws-kms`                            | `SETTLEMENT_AUTHORITY_SECRET_KEY_CIPHERTEXT`                                        |
| Relayer fee payer    | `RELAYER_FEE_PAYER_PROVIDER=aws-kms`                               | `RELAYER_FEE_PAYER_SECRET_KEY_CIPHERTEXT`                                           |

**Verify before removing the raw value.** The boot log names the provider, and
`GET /health` fails if a signer cannot resolve. Keep the raw environment value
in place until one full recovery and one settlement have run under KMS, because
the vault opens rows under whichever key id sealed them and a half-migrated
deployment is a supported state, not a broken one.

**Rotating the vault key later** does not need a migration. Put the new key
first in `RECOVERY_VAULT_KEYS` as `id:base64`, leave the old entry in place so
existing rows still open, and reseal when convenient. Removing an id before its
rows are resealed is what makes a row unopenable, so drop an entry only after a
reseal reports zero rows left under it.

## 10. Verify the Turnkey policies before enabling them

`TURNKEY_POLICIES_ENABLED` ships **false** and must stay false until this is
done. The policy bodies are built and unit tested against a pinned JSON shape,
but they have never been sent to Turnkey, so the flag is a claim the code cannot
yet support.

1. Create a throwaway sub-organization in a Turnkey test organization.
2. Turn the flag on for a local backend pointed at that organization and enrol a
   device, so the policies are created the way production would create them.
3. Confirm in the Turnkey dashboard that the policies exist on the
   sub-organization and read as intended.
4. Prove both directions with a real signing request: a Squads settings change
   or spend is stamped, and a transaction carrying an instruction to a program
   outside the allowlist is refused by Turnkey rather than by our code.
5. Only then enable the flag in production, and only for new sub-organizations.
   Existing ones were created without policies and need a backfill, which does
   not exist yet: write it before turning the flag on for an account that
   already holds money.

If step 4 refuses something it should allow, the payloads are wrong and the flag
goes back off. A policy that blocks a legitimate above-limit Spend takes the
Account's second signature away, which is worse than having no policy at all.

## 11. Close the Privy email login, in this order

O7's second question stopped mattering for Consumers, because there are none in
production, but it still matters for the internal accounts and for one real
balance.

1. **Sweep first.** Roughly 0.75 USDC left by the dApp Store reviewer sits on a
   mainnet Privy wallet whose only way in may be email. Move it before the
   method is disabled, or the answer to O7 stops being irrelevant.
2. Disable email as a login method in the Privy dashboard.
3. Confirm a fresh install still signs up: email proves the address and mints
   the recovery signer, the passkey creates the primary signer, and neither step
   asks Privy for an emailed code.
4. Re-create any internal test accounts the change strands. That is the accepted
   cost recorded in ADR 0027.
