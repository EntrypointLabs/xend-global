# Handoff: finish passkey-only sign-in, then decide S3

Written 2026-08-25. Everything described here is on `pay/p5-email` (PR #87), stacked on #86 on #85.

Read [`account-security-model-decisions.md`](./account-security-model-decisions.md) first, at minimum D4, D10, O4 and O10. This document assumes it.

## The one sentence that matters

**An email inbox still unlocks S1, and S1 alone spends up to the daily limit with no second approval and no time lock.** Closing that is the whole job. Everything below is either a step toward it or a thing that got in the way.

## Where it stands

|                                           |                                                            |
| ----------------------------------------- | ---------------------------------------------------------- |
| Email is contact detail, not a credential | Done, backend and mobile                                   |
| Passkey sign-in                           | Done, proven on a Seeker three times, `/auth/exchange 201` |
| Passkey sign-up                           | **Blocked on Privy.** See XEN-29                           |
| `/add-email`                              | Built, unreachable until sign-up works                     |
| Email login removed                       | **No.** Demoted to the recovery route only                 |
| S3                                        | Untouched. No code path unseals it                         |

## What to do, in order

### 1. Chase XEN-29

Privy answers `passkeys/register/init` with a 200 and a zero-length body. The write-up is ready to send: [`privy-passkey-signup-blocked.md`](./privy-passkey-signup-blocked.md). The dashboard toggle and the SDK version are both ruled out with evidence, so do not spend time re-checking them. The open guess, worth asking rather than asserting, is that the Android signing certificate is allow-listed for authentication but not for registration.

Nothing else in this workstream moves until this clears. Do not work around it by keeping email login: that is the thing being removed.

### 2. Verify the five-second auth window

The last commit changed the approval key from authenticate-per-use to a five second validity, because a per-use key can only be finished through a Keystore operation opened before the biometric prompt and held across it, and Keystore prunes operations to make room. Measured on a Seeker: a one second wait signs, a 111 second wait does not. It was hitting every signing path including `(send)/confirm.tsx`, so it was intermittently losing payments.

**Auth parameters cannot be changed after a key is created.** Existing enrolled keys keep the old model forever, so this only takes effect for keys enrolled after the change, and the signing path detects which model a key uses and takes the matching route.

So the test needs a **fresh enrolment**, not an existing account:

1. Install a dev client built from this branch. It must be an EAS `development` build, not `expo run:android`. See "The build trap" below.
2. Create a new account and let it enrol.
3. Trigger anything that signs with S2, then deliberately leave the fingerprint prompt sitting for two minutes before touching it.
4. It should sign. Before this change it failed with `ERR_SIGN`, and `adb logcat | grep INVALID_OPERATION_HANDLE` showed why.

While you are there, confirm the second account does not destroy the first one's key: enrol A, enrol B, then check A can still sign. That is the other native fix on this branch and it has not been exercised on hardware.

### 3. Then, and only then, decide S3

Do not start here. It is the most interesting problem and the wrong one to pick up first.

**The state:** `vault.open()` has no caller anywhere in the codebase. S3's key is sealed in `recovery_signers.sealed_key` and nothing can unseal it. The email-to-S3 recovery flow does not exist.

**Why that matters more than it looks:** it is currently the only reason one inbox does not reach two signers. S1 is reachable by email login today. The day someone wires an unseal path to a proof of the same inbox, that inbox holds S1 and S3, which is threshold 2, which is the entire account after the time lock. That is the precise outcome D4 was rewritten to prevent.

**So the rule:** email login must be gone before any email-triggered S3 release ships. If you are building the S3 recovery flow and email login still works, stop.

The custody question (hold S3 ourselves, or move to a vendor) is open and undecided. It was deferred deliberately, not forgotten.

## Traps that cost time on this branch

**The build trap.** The dev client is an EAS `development` build signed with EAS-managed credentials. `npx expo run:android` signs with `android/app/debug.keystore`, a different certificate, so it cannot install as an update. Forcing it means uninstalling, which wipes Android Keystore and kills the approval keys of every account on the device, and it changes the signing certificate, which breaks passkeys because Privy allow-lists the certificate. Use `eas build --profile development --platform android`, never `--local`.

**Expo Go is not the dev client.** Launching `exp://127.0.0.1:8081` opens Expo Go, which cannot load custom native modules and dies with `Cannot find native module 'HardwareKey'`. Both apps are installed on the Seeker. Launch with:

```
adb shell am start -n com.giftedborg.xend/.MainActivity \
  -a android.intent.action.VIEW \
  -d "xend://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081"
```

**Rejection needs two signatures.** At 2 of 3, one rejection is recorded and the change stays `Active`. A one-signature rejection reports success and stops nothing. Four LiteSVM tests in `packages/smart-account` pin this, including that a repeat from the same signer fails.

**A device with two accounts.** One Keystore alias per app meant enrolling a second account deleted the first account's approval key, unrecoverably, because replacing a signer needs two of three and that key is one of them. Fixed on this branch. Any account broken before the fix stays broken, including `gkenny896@gmail.com` on the Seeker, whose stuck proposal 2 can never be settled.

**Errors that lie.** Two layers were discarding the real reason. `toHttp` flattened chain failures into a 503 reading "Could not create the Account", and the mobile modal shows one message for every failure. Both now log the cause. If something fails and the reason looks generic, check the log before believing the message.

## Known-broken state on the Seeker, do not chase it

`gkenny896@gmail.com` has an `Active` proposal at index 2 that cannot be settled. S1 already rejected it, and only S2 can supply the second rejection, and that account's S2 key was destroyed on 2026-08-18 when a second account enrolled on the same phone. The banner is permanent for that account. It is dev residue, not a bug to fix.
