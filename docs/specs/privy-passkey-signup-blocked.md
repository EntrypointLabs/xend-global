# Passkey sign-up is blocked: Privy answers `register/init` with 200 and no body

**Open as of 2026-08-24.** Passkey **sign-in** works end to end on a physical
device. Passkey **sign-up** cannot complete, because the first call Privy's own
SDK makes returns a success status with a zero-length body, which no client can
parse.

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
2. Is the native app identity allow-listed separately for **registration**
   versus **authentication**? Our Android signing certificate was added to the
   dashboard on 2026-08-21 to fix a previous passkey failure, and
   authentication has worked since. If registration reads a different list,
   that would explain why one path works and the other returns nothing.
3. Does `passkeys_for_signup_enabled` have a second condition behind it that is
   not reflected in the public app config?
4. Related, and previously raised as `O7`: can support reset a user's wallet
   MFA out of band, and does disabling email login app-wide block users who
   already have an email linked?

## Why this matters to us

Our signer model requires that the email inbox must not unlock the primary
signer. Today it still does, because email OTP login returns the same Privy
embedded wallet that holds our primary signer. Passkey-only sign-up is how we
remove email as a way in. Until `register/init` works, we cannot create an
account without an email, so email login has to stay, and the property we need
cannot hold.
