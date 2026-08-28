# Handoff: finish sign-up end to end, then build email recovery

Written 2026-08-25, rewritten 2026-08-26 after #87 merged. Everything described here is on `main`.

Read [`account-security-model-decisions.md`](./account-security-model-decisions.md) first, at minimum D4, D10, D10b, D10c, O4 and O10. This document assumes it.

## The one sentence that matters

**An email inbox still unlocks S1, and S1 alone spends up to the daily limit with no second approval and no time lock.** Closing that is the whole job. Everything below is either a step toward it or a thing that got in the way.

It also gates the store. A dApp Store listing is general availability, and O10 says email login must not reach general availability, so the resubmission waits on the same blocker sign-up does.

## Where it stands

|                                               |                                                                 |
| --------------------------------------------- | --------------------------------------------------------------- |
| Email is contact detail, not a credential     | Done, backend and mobile                                        |
| Passkey sign-in                               | Done, proven on a Seeker three times, `/auth/exchange 201`      |
| Passkey sign-up                               | **Blocked on Privy.** See XEN-29                                |
| `/add-email`                                  | Built. Only reachable after sign-up, or from the shell reminder |
| Account creation, three signers               | Built. S3 is minted server-side and requires an email on file   |
| Provisioning, both policies then the 24h lock | Built and device-driven. Never run on mainnet                   |
| Sweep into the vault                          | Built, runs last in setup                                       |
| Email login removed                           | **No.** Demoted to the recovery route only                      |
| Email recovery release of S3                  | **Does not exist.** `vault.open()` still has no caller          |

## The sign-up flow as it is built

The whole path, so the next person does not have to reconstruct it from screens.

1. **`app/(auth)/login.tsx`, "Continue with Passkey".** `usePasskeyLogin.signIn` authenticates with Privy, then `completePasskeySession` exchanges the identity token for a Xend JWT. A passkey that worked leaves the session in exactly the state an email code would have.
2. **No credential on the device** surfaces as `no-passkey`, which opens `NoPasskeyModal`. "Create" calls `signUp()`. **This is where it stops today**, because Privy answers `passkeys/register/init` with a 200 and an empty body.
3. **`app/add-email.tsx`.** Saves the contact address (`409` means the address already anchors another Account's recovery signer), then opens `AccountSetupModal` so the fingerprint prompt arrives as part of signing up rather than on an empty dashboard.
4. **`useAccountSetup`**, in order: `enrol` creates the Turnkey approval signer (S2), mints and seals S3 against the contact address, and creates the Squads Account with all three; `provision` walks the settings change that creates both policies and sets the lock to 24 hours; `sweep` moves funds into the vault, last, because until both policies exist nothing can spend them back out.
5. **"Not now" is allowed** and leaves the Consumer on their Privy wallet with no Account. `AccountSetupReminder` asks again once per launch, and routes back to `/add-email` when there is still no address on file. That is deliberate: `AccountService.build` throws `IncompleteSignerSetError` without an email, because the recovery signer is anchored on it, so no email means no Account by design.

What is proven on hardware: sign-in, `/auth/exchange`, enrolment, provisioning and a Spend, all on devnet, all through the email route. What is not proven anywhere: sign-up itself, and every step above on mainnet.

## What to do, in order

### 1. Chase XEN-29

Privy answers `passkeys/register/init` with a 200 and a zero-length body. The write-up is ready to send: [`privy-passkey-signup-blocked.md`](./privy-passkey-signup-blocked.md), and the reply to their support bot is already on the issue. The dashboard toggle and the SDK version are both ruled out with evidence, so do not spend time re-checking them. The open guess, worth asking rather than asserting, is that the Android signing certificate is allow-listed for authentication but not for registration.

`apps/mobile/utils/privyRequestLog.ts` has uncommitted changes that capture the request and response headers on every passkey call, with token-like fields redacted. Keep them until this closes.

Nothing else in this workstream moves until it clears. Do not work around it by keeping email login: that is the thing being removed.

### 2. Verify the five-second auth window

The last commit changed the approval key from authenticate-per-use to a five second validity, because a per-use key can only be finished through a Keystore operation opened before the biometric prompt and held across it, and Keystore prunes operations to make room. Measured on a Seeker: a one second wait signs, a 111 second wait does not. It was hitting every signing path including `(send)/confirm.tsx`, so it was intermittently losing payments.

**Auth parameters cannot be changed after a key is created.** Existing enrolled keys keep the old model forever, so this only takes effect for keys enrolled after the change, and the signing path detects which model a key uses and takes the matching route.

So the test needs a **fresh enrolment**, not an existing account:

1. Install a dev client built from `main`. It must be an EAS `development` build, not `expo run:android`. See "The build trap" below.
2. Create a new account and let it enrol.
3. Trigger anything that signs with S2, then deliberately leave the fingerprint prompt sitting for two minutes before touching it.
4. It should sign. Before this change it failed with `ERR_SIGN`, and `adb logcat | grep INVALID_OPERATION_HANDLE` showed why.

While you are there, confirm the second account does not destroy the first one's key: enrol A, enrol B, then check A can still sign. That is the other native fix and it has not been exercised on hardware.

### 3. Walk the whole sign-up once and check the end state

Do this through the email route now, rather than waiting on XEN-29. Everything after step 2 of the flow is shared, so proving it early means that when passkey sign-up clears, the only untested thing left is passkey sign-up.

At the end of a completed sign-up all of this must be true:

- Xend session established, `/auth/exchange 201`
- Contact email stored, and an `active` row in `recovery_signers` for it
- On-chain settings account carries three distinct signers at threshold 2
- Both policies exist: the spending limit and the above-limit policy
- Time lock reads 86400
- The sweep landed and the vault holds the balance
- One Spend under the limit succeeds with one signature, one above it succeeds with two

If any of those is missing the Consumer is in the half-built state `AccountSetupReminder` exists to catch, which is recoverable but should not be normal.

### 4. Then build email recovery

This is the piece the product does not have. S3 is minted, sealed and stored at Account creation, and nothing can ever open it.

**What exists.** `apps/backend/src/recovery/` holds the whole signer lifecycle: `ensureEmailSigner` at onboarding (idempotent, so a failed enrolment can retry without stranding the Account), add and remove with the last-signer rule, rotation that mints a fresh keypair, the change lock that claims a Settings index, and the account events that log it. `RecoveryVault` seals under an env AES-256-GCM key with a `keyId` so custody can move to KMS as a migration.

**What is missing.**

- Nothing calls `vault.open()`. There is no release path at all.
- No proof of email that belongs to us. The only email proof in the product today is Privy's OTP login, and using that as the release factor is exactly what O10 forbids.
- No lost-phone path. D10c's second row (new sub-org, new hardware key on the new phone, settings change swapping the old S2 pubkey for the new one) has no caller on either side.
- "Recover existing wallet" on the login screen still routes to Privy email OTP.

**The shape to build**, from D10c and D5b:

1. New phone, passkey signs in. That is S1.
2. The device generates a hardware key and the backend creates a fresh Turnkey sub-org, giving a new S2 address. The old sub-org is unrecoverable by design, so this is a new key, not a port.
3. The Consumer proves the contact address with an OTP we issue and verify ourselves.
4. The backend opens the sealed key and signs the settings change that swaps old S2 for new. S1 signs on the device. That is threshold 2 without the backend ever holding two signers.
5. The change sits under the 24 hour lock, notified, rejectable with S1 plus S2 from the old phone if it was not really lost.

**Rules that are not negotiable.**

- Email login must be gone before this ships. While it works, an inbox reaches S1, and an inbox that also releases S3 holds two of three.
- The OTP is ours. Do not reach for Privy's.
- The backend never gets a second signer, not even temporarily, not even to make provisioning simpler (O6).
- The notification is load-bearing. Without a push on a pending settings change the time lock protects nobody, and that is the only control standing between a compromised inbox plus passkey and the Account.

**One question for a human before any of it is built.** The iPhone to Android case. The passkey does not cross platforms, so S1 goes with it, S2 was already gone with the old phone, and S3 alone is one vote against a threshold of two. D10's table says S3 survives, which is true and not sufficient. Either a second recovery signer becomes mandatory so that pair can reach threshold, which means onboarding asks for something more, or the cross-platform switch is knowingly unsupported. That decision changes the sign-up screens, so take it first.

The custody question, hold S3 ourselves or move it to a third vendor with email auth, is open and undecided. It was deferred deliberately, not forgotten, and the security property is identical either way.

## Traps that cost time

**The build trap.** The dev client is an EAS `development` build signed with EAS-managed credentials. `npx expo run:android` signs with `android/app/debug.keystore`, a different certificate, so it cannot install as an update. Forcing it means uninstalling, which wipes Android Keystore and kills the approval keys of every account on the device, and it changes the signing certificate, which breaks passkeys because Privy allow-lists the certificate. Use `eas build --profile development --platform android`, never `--local`.

**Expo Go is not the dev client.** Launching `exp://127.0.0.1:8081` opens Expo Go, which cannot load custom native modules and dies with `Cannot find native module 'HardwareKey'`. Both apps are installed on the Seeker. Launch with:

```
adb shell am start -n com.giftedborg.xend/.MainActivity \
  -a android.intent.action.VIEW \
  -d "xend://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081"
```

**Rejection needs two signatures.** At 2 of 3, one rejection is recorded and the change stays `Active`. A one-signature rejection reports success and stops nothing. Four LiteSVM tests in `packages/smart-account` pin this, including that a repeat from the same signer fails.

**A device with two accounts.** One Keystore alias per app meant enrolling a second account deleted the first account's approval key, unrecoverably, because replacing a signer needs two of three and that key is one of them. Fixed. Any account broken before the fix stays broken.

**Errors that lie.** Two layers were discarding the real reason. `toHttp` flattened chain failures into a 503 reading "Could not create the Account", and the mobile modal shows one message for every failure. Both now log the cause. If something fails and the reason looks generic, check the log before believing the message.

## Known-broken state on the Seeker, do not chase it

`gkenny896@gmail.com` has an `Active` proposal at index 2 that cannot be settled. S1 already rejected it, and only S2 can supply the second rejection, and that account's S2 key was destroyed on 2026-08-18 when a second account enrolled on the same phone. The banner is permanent for that account. It is dev residue, not a bug to fix.

## Before we resubmit on the Solana dApp Store

The sequencing decision still holds: the multisig ships before the resubmission, because the Account changes every Consumer's receive address and a listing is exactly the event that makes "there are no users yet" stop being true.

What follows was checked against the repo and against EAS on 2026-08-26, not copied from [`dapp-store-resubmission.md`](./dapp-store-resubmission.md), which is stale in two places (see the end).

### On the critical path

1. **XEN-29, and email login removed after it.** Shipping to the store with email login live is the state O10 forbids, in the one place that makes it general.
2. **The backend is a free ngrok tunnel on a laptop.** EAS `production` still carries `EXPO_PUBLIC_BACKEND_URL=https://unvertiginous-echinate-shawana.ngrok-free.dev`. There is no deploy pipeline, and the backend needs Postgres, Redis and Kafka. This is the largest remaining risk and it needs a human.
3. **Mainnet has never seen an Account.** The network config is right: EAS `production` reads `EXPO_PUBLIC_SOLANA_CLUSTER=mainnet` with the mainnet USDC mint, which is what the last rejection was about. But every Account, provisioning run and Spend so far has been devnet or local. Create one Account on mainnet, provision it, then send once under the limit and once above it.
4. **One real mainnet swap on a funded device.** Swap quotes through Socket and executes; it has never settled on chain.
5. **The reviewer's balance.** Roughly 0.75 USDC still sits on a mainnet Privy wallet. The sweep exists. Run it and confirm it lands in the vault.

### The listing itself, which needs the publisher

6. **Reshoot the previews.** `assets/dapp-store/preview-*.png` still show a Visa-branded card, a virtual bank account, 7.99% APY and merchant charges, none of which the app can do. Fresh captures of the current build are in `.gstack/previews-new/`. Home and Receive are the two to avoid.
7. **Re-read the listing copy against what the app actually does.** The rejection was about the gap between the two, and the copy lives in the publisher portal rather than in this repo.
8. **Three surfaces look real and do nothing:** Xend Card raises a "coming soon" toast, Earn Deposit opens Receive, and Hide My Wallet is gated off. A feature the listing does not claim is a teaser; one it claims is the rejection repeating.
9. **Token logos.** Kamino, SOL and USDC render as letter-in-a-circle placeholders because no artwork exists in the repo. Most visible on the Swap token pills.
10. **Two secrets gate the submission and neither is on the build machine:** `DAPP_STORE_API_KEY` from the publisher portal, and the Solana signer keypair. Both are held by the publisher. Everything else about the submission is ready.

### Do not relearn the build traps

`.easignore` replaces `.gitignore` rather than extending it; an extraneous transitive dependency passes typecheck, lint, jest and `expo export` and then fails Metro on a clean builder; `eas build:view` hides the real error and the GraphQL API shows it; never run `eas build --local`, which fetches the production keystore onto the machine. All four are written up in [`dapp-store-resubmission.md`](./dapp-store-resubmission.md).

**That document is stale in two places.** It says Swap has no quote provider wired, which is no longer true, and it says the mainnet cluster and mint are set in `eas.json`, when the `production` profile carries no env at all and those values live in EAS environment variables. Trust this list, and fix that document when you next touch it.
