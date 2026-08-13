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
3. **A Spend.** The two-signature route is exercised by default because no
   spending limit exists yet, so this also proves the Turnkey stamp.
4. **Low-S.** If Turnkey rejects a stamp as an invalid signature, the
   normalisation in `modules/hardware-key/src/lowS.ts` is the first place to
   look. It is unit tested, but only against synthetic signatures.

## 7. Create the spending limit, and mind the 24-hour wait

Until a spending limit policy exists, **every** Spend takes the two-signature
route and needs the phone. That is safe but not the product: D5 wants everyday
Spends at one tap.

Creating the policy is a settings change, so it is subject to the 24-hour
Settings time lock from D3. A Consumer therefore cannot have a spending limit on
their first day. Decide deliberately whether that is acceptable for the pilot or
whether the time lock should start shorter and be raised.
