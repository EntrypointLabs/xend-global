# Passkey enrolment fails on Android, cause not yet found

Paused on 2026-08-17 so it stops blocking multisig work. Passkey setup is
skippable, so nothing downstream depends on it.

## What happens

Adding a passkey during sign-up fails. The Consumer sees roughly "Invalid ID"
in `PasskeySetupModal`, which renders whatever `linkWithPasskey` threw. Skipping
it lets sign-up finish normally.

Seen on `bensondiana41@gmail.com`, every attempt, including before any of the
2026-08-17 changes. `gkenny896@gmail.com` already has a passkey and can sign in
with it, so the failure is on **creating** a credential, not using one. Creating
and using go through different validation, so a working sign-in says nothing
about whether enrolment still works.

## Ruled out, with evidence

Everything from the app up to WebAuthn checks out. None of this is worth
re-testing without a reason.

| Claim                              | Evidence                                                                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Our code did not change            | `hooks/usePasskey.ts` unmodified; last commit predates the work that preceded this                                                                                   |
| Relying party is right             | `RELYING_PARTY = "https://xend.global"`, and Privy derives `rp.id` from the registrable domain                                                                       |
| App and client IDs are right       | `EXPO_PUBLIC_PRIVY_APP_ID=cmpzkklkr004m0ci8l1irlzp6`, client id is the `com.giftedborg.xend` one, package matches the APK                                            |
| Signing certificate did not change | The 2026-08-17 APK is signed `48:11:A9:82:…:C9:9B`, byte-identical to the previous build's signer                                                                    |
| That certificate is linked         | It is in `xend.global/.well-known/assetlinks.json`, and Google's Digital Asset Links API returns `linked: true` for **both** `get_login_creds` and `handle_all_urls` |
| The auth-ordering fix is unrelated | `linkWithPasskey` runs inside the Privy SDK against the Privy session and never sees our JWT                                                                         |

`passkey_credentials` in the local database has always been empty for both
accounts. That table is filled by a fire-and-forget mirror whose failure is
swallowed on purpose, so it is weak evidence either way, not proof that no
passkey exists.

## What is still unknown

- **The exact error string.** "Invalid ID" is close to several distinct Privy
  failures that point in different directions: invalid relying party, invalid
  app identifier, invalid client id. `usePasskey` puts `err.message` into the
  modal and it also reaches Metro. Capture it verbatim first; it likely
  shortcuts everything below.
- **Whether it is account-specific.** Try creating a _new_ passkey on
  `gkenny896`, or on a second device. If that also fails it is configuration and
  affects everyone; if only `bensondiana41` fails it is account state.
- **Privy console configuration.** Passkeys are enabled and these are listed as
  allowed app identifiers: `com.giftedborg.xend`, `com.giftedborg.xend.dev`,
  `host.exp.Exponent`, `io.sqds.xend`, `xend.global`. That last one is a domain
  rather than a bundle id, so it may be in the wrong field; the WebAuthn
  relying-party domain is usually configured separately. Unverified, since the
  console is not visible from here.
- **Identity tokens.** Enrolment needed these enabled in the Privy dashboard
  when it was first built. Worth confirming they still are on this app, which is
  not the app the feature was originally developed against.

## Where to look

- `apps/mobile/hooks/usePasskey.ts` — the ceremony and its error handling
- `apps/mobile/app/(auth)/email-login.tsx` — where setup is offered and skipped
- `apps/mobile/components/ui/organisms/modals/PasskeySetupModal.tsx` — what the
  Consumer reads

## Why it is not urgent

Skipping is a first-class path. A Consumer without a passkey signs in by email
OTP, and the passkey is not one of the Account's three signers: S1 is the Privy
embedded wallet, S2 the device hardware key, S3 the server-held recovery signer.
Losing a passkey costs convenience at sign-in, not access to money.
