**Status (2026-09-07): Resolved 2026-08-21.** Kept for the diagnosis. The Digital Asset Links and signing-certificate steps it records are still the ones to repeat for a new build certificate.

# Passkeys failed because Privy did not accept this build's signing certificate

**Resolved 2026-08-21.** The certificate was added to the Privy dashboard and
both directions were verified on a physical device:

|                               |                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `POST /passkeys/authenticate` | **200** — the 2026-07-02 credential signed in, no re-enrolment needed                   |
| `POST /passkeys/link`         | **200** — a fresh account enrolled `F5YORrmxCipG2dA8Lu_v7g` via Google Password Manager |

The rest of this document is kept because every check that came before the fix
passed while the feature was broken, and it is worth knowing why.

---

Root cause found 2026-08-21 on a physical Android device (Solana Seeker,
`com.giftedborg.xend` versionCode 18). Privy stated it verbatim:

```
Unexpected authentication response origin
  "android:apk-key-hash:SBGpgtRVqmy1WzwMYSLjcCtPRKJZ4efWs29ia-9eyZs",
expected one of:
  https://xend.global,
  android:apk-key-hash:-sYXRdwJA3hvue3mKpYrOZ9zSPC7b4mbgzJmdZEDO5w
```

Decoded, those two hashes are certificate fingerprints:

|                                       | SHA-256 fingerprint   |
| ------------------------------------- | --------------------- |
| The APK on the device is signed with  | `48:11:A9:82:…:C9:9B` |
| The only Android origin Privy accepts | `FA:C6:17:45:…:3B:9C` |

`xend.global/.well-known/assetlinks.json` publishes **both**. Privy's dashboard
has only the `FA:C6:17:45:…` one. So every passkey ceremony from a build signed
with `48:11:A9:82:…` is rejected.

## The fix

Privy keeps **two separate allowlists**, and only the second one is wrong:

| List                                       | Holds                                  | State                         |
| ------------------------------------------ | -------------------------------------- | ----------------------------- |
| Allowed app identifiers, per Client        | the package name `com.giftedborg.xend` | correct                       |
| Allowed Android key hashes, `Settings` tab | the SHA-256 signing certificate        | **missing this build's cert** |

Every earlier investigation checked the first list. The passkey origin comes
from the second.

In the dashboard for app `cmpzkklkr004m0ci8l1irlzp6`, under `Settings` →
allowed Android key hashes, **add** (do not replace) the EAS-managed keystore
that signs the development and internal-distribution builds:

```
48:11:A9:82:D4:55:AA:6C:B5:5B:3C:0C:61:22:E3:70:2B:4F:44:A2:59:E1:E7:D6:B3:6F:62:6B:EF:5E:C9:9B
```

Privy's documentation calls this field's value `sha256_cert_fingerprint`, the
same colon-separated form used in `assetlinks.json`. If the field wants the
origin encoding instead, it is the same certificate as
`android:apk-key-hash:SBGpgtRVqmy1WzwMYSLjcCtPRKJZ4efWs29ia-9eyZs`; Privy
converts hex to base64url internally, which is why its error is phrased in
base64url.

Keep the existing `FA:C6:17:45:…` entry. Both certificates are live and both
are already published in the asset links.

`eas credentials -p android` prints the fingerprint for a given build profile,
if it needs re-checking after a keystore change.

Nothing in this repository needs to change.

## Why every earlier check passed and still missed it

The previous investigation was not sloppy; it checked the wrong authority.

- **assetlinks.json is correct.** It serves `200` to a plain non-browser client,
  no redirect, `application/json`, both `handle_all_urls` and
  `get_login_creds`, and both fingerprints. Verified again on 2026-08-21.
- **Google's Digital Asset Links API returns `linked: true`.** It would — the
  file lists the certificate.
- **Privy does not derive its Android origin allowlist from asset links.** It
  uses its own dashboard configuration. That is the gap: the domain vouches for
  the certificate, and Privy never reads the vouching.
- **"The signing certificate did not change"** compared two August builds, both
  signed `48:11:A9:82:…`. The July build that enrolled successfully was signed
  with the other key. The comparison was too narrowly scoped to see the change.

## How the error was finally surfaced

Privy returns a generic `{"error":"Invalid request","code":"invalid_credentials"}`
for both registration and authentication. The specific origin message only
appears on **authentication with a credential Privy already knows**. Any other
path fails earlier, on an unknown credential, and returns the generic body.

The sequence that produced it:

1. Log the ceremony in both directions, including request bodies
   (`apps/mobile/utils/privyRequestLog.ts`). The SDK calls `fetch` with a
   `Request`, so the body and method are on it, not on `init`.
2. Attempt sign-in with the credential recorded on the account
   (`linked_accounts[].credential_id`).
3. Privy sends `allow_credentials: null`, so the picker offers every
   `xend.global` passkey on the device. Because failed enrolments leave orphan
   credentials behind and Privy sets every user's `name`/`display_name` to the
   app name, the entries are indistinguishable, and the picker will usually
   return an orphan. Injecting `allow_credentials` with the known credential id
   forces the right one and reveals the real error.

## What was ruled out on the way, with evidence

Do not re-run these.

| Claim                           | Evidence                                                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 1 of the ceremony is fine  | `POST /passkeys/link/init` returns 200 with valid options                                                                                                             |
| The credential itself is valid  | challenge issued vs. signed match byte for byte; `rpIdHash` equals `sha256("xend.global")`; flags `0x5d` — UP, UV, BE, BS, AT                                         |
| Not account-specific            | a brand-new Privy user with no passkey fails identically                                                                                                              |
| Not a duplicate or device clash | every attempt minted a unique credential id; nothing was overwritten; authentication creates nothing and fails the same way                                           |
| Not the attestation preference  | Privy requests `attestation: "direct"` and Android returns `fmt: "none"`, but authentication carries no attestation at all and fails identically                      |
| Not the SDK version             | `@privy-io/expo` 0.70.11 unpacked and compared against 0.67.1: identical `create()` arguments, identical hard-coded `clientExtensionResults: {}`, identical transform |
| Not our code                    | the SDK contains no Android origin handling; that verification is entirely server-side                                                                                |

The Consumer-facing string is **"Invalid request"**. An earlier draft recorded
it as "Invalid ID", and that wrong string is what sent the first investigation
toward relying-party and app-identifier theories.

## Clean-up once the dashboard is fixed

- Failed enrolments left orphan passkeys for `xend.global` in Google Password
  Manager on the test device. Delete them, or the sign-in picker will keep
  offering credentials Privy has never seen.
- `gkenny896@gmail.com` has a real credential on record (`Gc-_GNUvz-CLdO_Dm6wg9A`,
  enrolled 2026-07-02 via Google Password Manager) that should start working
  again without re-enrolment, since the credential was always valid.
- Re-test enrolment and sign-in on a fresh account to confirm both directions.

## Worth raising with Privy separately

Neither of these blocks anything, but both cost time here.

- `invalid_credentials` is returned for genuinely different failures. The origin
  mismatch is only reported when the credential is already known; otherwise the
  body says nothing useful.
- `allow_credentials` is `null` on authentication, and `name`/`display_name` are
  the app name for every user, so a device with more than one credential for the
  relying party presents an unusable picker.

## Why it was never urgent

Skipping is a first-class path. A Consumer without a passkey signs in by email
OTP, and the passkey is not one of the Account's three signers: S1 is the Privy
embedded wallet, S2 the device hardware key, S3 the server-held recovery
signer. Losing a passkey costs convenience at sign-in, not access to money.
