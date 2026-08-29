# Handoff: sign-up, S3 and recovery

Written 2026-08-25, rewritten 2026-08-29 after the recovery work landed. Everything described here is on `pay/p6-recovery`.

Read [`account-security-model-decisions.md`](./account-security-model-decisions.md) first, at minimum D4, D10, D10b, D10c, O4 and O10. This document assumes it.

## What changed

The last version of this opened by saying an email inbox still unlocked S1, and that closing it was the whole job. That is done, and so is most of what depended on it.

|                                           |                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------- |
| Passkey sign-up                           | Works. XEN-29 did not reproduce, and one was created by hand        |
| Sign-up end to end                        | Proven on a Seeker: passkey, verified email, Account, both policies |
| Contact address, proved before it is used | Done. No verified address, no Account                               |
| S3 minted, sealed, anchored               | Done, and the anchor moves when the contact address moves           |
| S3 released against an emailed code       | Done. `vault.open()` finally has a caller                           |
| Second email recovery key                 | Done. 2 of 3 on the test Account, waiting out its lock              |
| Lost-phone restore onto a new device      | Built and driven end to end, minus the 24 hour wait                 |
| Email login removed                       | **No.** Still the migration route. See "What is left"               |

## The flows as they now run

### Sign-up

1. **`app/(auth)/login.tsx`.** "Continue with Passkey" signs in; "New here? Create an account" creates one. That second button is not decoration. On a device holding no credential for the relying party, Android does not answer `NoCredentials`: it offers to sign in from another device, and backing out of that reads as a cancellation. The path that used to reveal "create an account" was therefore unreachable for exactly the person who needed it, which on a fresh install is everyone.
2. **`app/add-email.tsx`.** Address, then a six-digit code, then the Account is built. Not skippable: S3 is anchored on this address and is mandatory at creation (D10b), so a Consumer without one has no Account and no recovery signer at all, which is the 0 of 3 state the design exists to prevent. The only ways off that screen are a proved address or signing out.
3. **`useAccountSetup`.** Enrol (Turnkey approval signer, S3 minted and sealed, Account created with all three signers), provision (one settings change carrying both policies and then the 24 hour lock), sweep.

Where the Consumer lands is derived from what is on file rather than from a flag raised mid-flow, so an interrupted sign-up resumes instead of stranding somebody on a dashboard with nothing behind it.

### What an emailed code buys

Three uses, easy to confuse, so they are listed rather than described:

| Purpose                | What the code proves        | What it then permits                                    |
| ---------------------- | --------------------------- | ------------------------------------------------------- |
| `contact_verification` | The address at sign-up      | Anchoring S3 on it, and creating the Account            |
| `recovery_key_email`   | A second address            | Staging it as an additional recovery key                |
| `device_rotation`      | The address already on file | Releasing S3 to approve the swap of the approval signer |

Codes are scrypt-hashed with a per-row salt, expire in ten minutes, survive five guesses and five sends an hour, and are spent once. A code issued for one purpose cannot be spent on another, which is why the purpose is an enum and not a boolean.

### Restoring onto a new phone

The phone holding S2 is gone and its key cannot be copied, so a new one is minted here and swapped in. That swap needs two of three and the missing one is S2, so the pair is S1 on the new phone and S3 in the vault.

1. The home banner says the phone cannot approve. Until it can, the Account can be looked at and not spent from, and nothing else on the screen explains that.
2. A code goes to the address on file. Verifying it produces a grant good for fifteen minutes, which covers proposing and both approvals and deliberately does not cover executing.
3. This phone mints a hardware key and **attests it**, exactly as enrolment does. The backend derives the key from the verified attestation and never from the request body: taking it on trust would let a caller attest with real hardware and rotate a software key into the signer set of an Account that already holds money.
4. Propose and approve-primary are signed by the passkey. The recovery approval is produced server-side from the sealed key and never reaches the device.
5. Twenty-four hours, then `DeviceRotationRunner` lands the execute step on whichever launch comes next.

`buildRotateApprovalSigner` carries the policy update in the same change, and that is the part easy to miss. A policy holds **its own inline signer set**, copied at creation and never re-read from the Settings, so rotating only the Settings leaves a recovered Account able to make small Spends and permanently unable to make large ones. Four LiteSVM tests against the deployed bytecode pin it, including that the old key cannot spend afterwards.

## Things that cost time, so they are written down

**An unjournalled migration is silently skipped.** `drizzle-kit migrate` reads `drizzle/meta/_journal.json`, not the directory, and reports success either way. A hand-written `.sql` needs a journal entry or it never runs. Verify against the database, not the command's output.

**A dead `nest --watch` parent leaves stale code serving.** Every route added that afternoon 404'd while the older ones worked normally. If a new endpoint 404s locally, check the backend is running what is on disk before debugging the endpoint.

**Not every 404 means "no Account".** `getAccount()` used to map any 404 to null, so one bad response from the tunnel told a finished Consumer their sign-up was unfinished, and the setup prompt nagged them about it.

**A key on the device is not the same as this Account's key.** The native lookup falls back to the alias used before keys were scoped per account, so a phone that once enrolled a different account hands back that account's key: present, and useless here. The Account now reports the hardware key it enrolled with and the app compares rather than counts. Nothing but wiping a real key and watching what happened would have caught it.

**Whose change it is, is a fact about a device.** The server sees one Account with one staged change, so any flag it sets silences the alarm everywhere, including on the phone somebody is taking the Account away from, which is the one place it has to ring. The phone that stages a change records the index locally and only that phone stays quiet about it. Tapping "review" outranks the suppression: asking to see it is not the same as being ambushed by it.

**Testing the restore needs a second device.** A dev-only trigger on Keys & Recovery discarded this Account's Device Key while the flow was being built, which is the only way to simulate a lost phone on one handset; it has been removed. Re-add it against `hardwareKey.reset()`, which is still there, rather than clearing app data, which wipes the Keystore for every account on the phone.

## What is left

**Email login is still the migration route, and O10 stays open until it is gone.** Passkey sign-up works, so the blocker is no longer technical. What remains is choosing when to disable the method in the Privy dashboard, and O7 is still unanswered, so we do not know whether disabling it breaks Consumers who already have an address linked. `(auth)/email-login.tsx` and the "Recover existing wallet" button come out with it, and the lost-phone flow is what replaces them.

**Passkeys are indistinguishable in the platform picker.** Privy sets the WebAuthn user name to the app name, so every credential shows as "Xend Mobile" and a Consumer with two accounts cannot tell them apart. `signupWithPasskey` takes only `relyingParty`, so this is Privy's to fix; worth raising alongside XEN-29. `exclude_credentials` is empty at sign-up too, which is why the platform will mint a second credential for an identity that already has one.

**The iPhone to Android case is knowingly unsupported.** The passkey does not cross, so S1 goes with it, S2 was already gone, and S3 alone is one vote against a threshold of two. A second recovery key covers it, and adding one now works, but nothing requires a Consumer to have one.

**Custody of S3 is undecided.** Ours today, sealed under an env key with a `keyId` so KMS is a migration rather than a rewrite. A third vendor reads better commercially and buys the same security property.

**The review card has no illustration.** The reference in `docs/design/references/fuse/add-recovery-key-review.png` has one, there is no asset for it, and the wallet screen never had one either.

## Before the dApp Store resubmission

The sequencing decision still holds: the multisig ships before the resubmission.

1. **Email login has to be gone.** A listing is general availability, which is what O10 forbids. This is now the only thing between the work and the store.
2. **The backend is a free ngrok tunnel on a laptop.** EAS `production` still carries that URL, there is no deploy pipeline, and it needs Postgres, Redis and Kafka. Largest remaining risk, and it needs a human.
3. **Mainnet has never seen an Account.** The network config is right; every Account, provisioning run and Spend so far has been devnet or local. Create one on mainnet, provision it, then send once under the limit and once above it.
4. **One real mainnet swap on a funded device.** It quotes through Socket and executes, and has never settled on chain.
5. **The reviewer's balance.** Roughly 0.75 USDC on a mainnet Privy wallet. The sweep exists; run it. The address is readable from the Privy dashboard.
6. **Reshoot the listing previews.** `assets/dapp-store/preview-*.png` still show a Visa card, a virtual bank account, 7.99% APY and merchant charges. Fresh captures are in `.gstack/previews-new/`; Home and Receive are the two to avoid.
7. **Re-read the listing copy against what the app does.** It lives in the publisher portal, not the repo.
8. **Three surfaces still look real and do nothing:** Xend Card, Earn Deposit, Hide My Wallet.
9. **Two secrets gate the submission and neither is on the build machine:** `DAPP_STORE_API_KEY` and the Solana signer keypair.

Token artwork is off this list: SOL, EURC and Kamino ship as real marks rather than letters in a circle.
