# Passkey sign-up is blocked: Privy answers `register/init` with 200 and no body

**Not reproduced on 2026-08-27 retest.** Passkey **sign-in** works end to end
on a physical device. The original passkey **sign-up** blocker was that the
first call Privy's own SDK makes returned a success status with a zero-length
body, which no client can parse. On the 2026-08-27 Seeker retest, that endpoint
returned a non-empty JSON body and Android advanced to the OS passkey creation
prompt.

This blocks removing email as a login method, which is the closing condition on
`O10` in [account-security-model-decisions.md](./account-security-model-decisions.md).

## What happens

`useSignupWithPasskey().signupWithPasskey({ relyingParty })` calls
`generateSignupOptions`, which posts to `passkeys/register/init`. On a physical
Android device, logged out, with no Privy session open:

```
-> POST https://auth.privy.io/api/v1/passkeys/register/init
   {"relying_party":"https://xend.global"}

<- POST https://auth.privy.io/api/v1/passkeys/register/init 200
   ''

   SyntaxError: JSON Parse error: Unexpected end of input
```

The device never reaches the platform's create-credential prompt, because the
SDK throws while parsing the options it was supposed to receive.

The response body is genuinely empty. Our fetch wrapper reads it from
`response.clone()`, and the same wrapper prints the full body for
`passkeys/authenticate` on the same device in the same session.

## Privy's response, 2026-08-27

Privy confirmed their backend logs show `register/init` returning `200` with a
valid body and a generated challenge. They believe the empty body is appearing
between their edge and the device runtime, so the next useful evidence has to
come from the device-side raw HTTP response before SDK parsing.

They also clarified the two allowlist layers:

- Allowed app identifiers gate both `register/init` and `authenticate` through
  the same middleware. A mismatch should return `403`, not an empty `200`.
- Android signing certificate / Digital Asset Links controls OS-level passkey
  association. Privy thinks incomplete propagation for `xend.global` can
  plausibly let authentication with an existing passkey work while blocking new
  passkey creation.

The other `handlePasskeyInitRegistration` gates — `passkeyAuth`, the
`passkeys_for_signup_enabled` dashboard flag, no identity allowlist on this
flow, a valid RP origin and a passing mobile native-app-id check — should all
return typed `4xx` responses with bodies when they fail.

## Retest, 2026-08-27

Device: Solana Seeker over USB, installed `com.giftedborg.xend` development
build `versionCode=18`, loaded against local Metro through the Expo development
client.

The app was temporarily pointed straight at `signupWithPasskey` in development
only so the sign-up path could be exercised without first dismissing a working
passkey sign-in sheet. That harness was removed after capture.

`register/init` now returns a full body on-device:

```
-> POST https://auth.privy.io/api/v1/passkeys/register/init
   headers:
     privy-app-id: cmpzkklkr004m0ci8l1irlzp6
     privy-client: expo:0.67.1
     privy-client-id: client-WY6ZcEKjXHmsBrxUBTwB7nTTvsdr8izBCeexyHGU8c3ai
     x-native-app-identifier: com.giftedborg.xend
   body:
     {"relying_party":"https://xend.global"}

<- POST https://auth.privy.io/api/v1/passkeys/register/init 200
   emptyBody: false
   content-type: application/json; charset=utf-8
   cf-ray: a316d9ffbf09751f-AMS
   x-vercel-id: fra1::iad1::hvrgs-1787789409246-4857035482d2
   body:
     {"options":{"challenge":"...","rp":{"name":"Xend Mobile","id":"xend.global"},"user":{"id":"...","name":"Xend Mobile","display_name":"Xend Mobile"},"pub_key_cred_params":[{"alg":-8,"type":"public-key"},{"alg":-7,"type":"public-key"},{"alg":-257,"type":"public-key"}],"timeout":60000,"exclude_credentials":[],"authenticator_selection":{"require_resident_key":true,"resident_key":"required","user_verification":"required"},"attestation":"direct","extensions":{"cred_props":{"rk":true}}}}
```

After that response, Android showed the Google Password Manager sheet:
`Create passkey to sign in to Xend?`, with RP display `Xend Mobile`, and waited
for fingerprint/PIN. That means the original empty-body failure is past the
network/SDK parse layer and no longer blocks the passkey creation ceremony.

## Next capture

`apps/mobile/utils/privyRequestLog.ts` now logs the failing Privy passkey fetch
with:

- transport path (`globalThis.fetch`, which on Android goes through React
  Native networking / OkHttp),
- selected request headers, including `x-native-app-identifier` when present,
- selected response headers, including `content-length` / `content-type`,
- an explicit `emptyBody` boolean,
- the response body before SDK parsing, with token-like JSON fields redacted.

Reproduce passkey sign-up on the failing Android build and capture the
`[privy] -> POST .../passkeys/register/init` and
`[privy] <- POST .../passkeys/register/init 200` console lines. If
`emptyBody: true` appears while Privy's logs show a challenge body, the remaining
suspect is the network/transport layer for that build. If the request lacks
`x-native-app-identifier` or carries an unexpected value, fix the native app ID
configuration before retesting.

## Environment

|                  |                                                            |
| ---------------- | ---------------------------------------------------------- |
| Privy app ID     | `cmpzkklkr004m0ci8l1irlzp6`                                |
| `@privy-io/expo` | 0.67.1                                                     |
| js-sdk-core      | 0.65.3                                                     |
| Device           | Solana Seeker, Android, physical hardware, not an emulator |
| Relying party    | `https://xend.global`                                      |
| Credential store | Google Password Manager                                    |

## What we ruled out, with evidence

**It is not the dashboard toggle.** Your public app config reports signup as
enabled:

```
GET https://auth.privy.io/api/v1/apps/cmpzkklkr004m0ci8l1irlzp6
  passkey_auth                = true
  passkeys_for_signup_enabled = true
```

That reading is meaningful rather than assumed, because a second app of ours
reports the opposite and behaves accordingly:

```
GET https://auth.privy.io/api/v1/apps/cmh55xa2t01zdjx0dlsf7bbit
  passkeys_for_signup_enabled = false

POST .../passkeys/register/init   (app cmh55xa2t01zdjx0dlsf7bbit)
403 {"error":"Signup with passkey not allowed","code":"disallowed_login_method"}
```

So when signup is disallowed, the endpoint says so with a clean 403 and a JSON
body. The app that has it **enabled** is the one returning an empty 200.

**It is not the SDK version.** We compared 0.67.1 against 0.70.11. The
`signupWithPasskey` implementation is identical, same `generateSignupOptions`
call into the same `register/init` endpoint. Upgrading would not change this.

**It is not a stale session.** `signupWithPasskey` throws
`attempted_login_with_passkey_while_already_logged_in` when one exists. We clear
any Privy session before calling, and this failure occurs with none open.

**Sign-in works from the same build, device and session.** Immediately before
and after the failing call:

```
<- POST https://auth.privy.io/api/v1/passkeys/authenticate 200
   {"user":{...},"token":"...","is_new_user":false}
```

So the app ID, client ID, relying party, signing certificate and native app
identity are all accepted for authentication.

## What we could not test from outside

Reproducing from curl stops at the mobile client check, which is presumably what
distinguishes our device's request from ours:

```
POST .../passkeys/register/init
  -H privy-app-id / privy-client-id / privy-client
403 {"error":"Missing native app ID from mobile client","code":"invalid_native_app_id"}
```

The device supplies that identity and gets past this point, since it receives a
200 rather than a 403.

## Questions for Privy

1. What causes `passkeys/register/init` to return **200 with an empty body**?
   Every documented failure mode we can find returns a 4xx with a JSON `code`.
2. Does Privy's edge, CDN or mobile SDK path have any known response-body
   stripping failure mode specific to React Native / OkHttp?
3. Can Privy confirm when the 2026-08-21 Android signing certificate is fully
   propagated through Digital Asset Links for `xend.global`?
4. Can Privy provide the exact expected native app identifier value for this
   Android app so we can compare it against the on-device header?

## Why this matters to us

Our signer model requires that the email inbox must not unlock the primary
signer. Today it still does, because email OTP login returns the same Privy
embedded wallet that holds our primary signer. Passkey-only sign-up is how we
remove email as a way in. Until `register/init` works, we cannot create an
account without an email, so email login has to stay, and the property we need
cannot hold.
