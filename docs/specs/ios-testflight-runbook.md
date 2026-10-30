# iOS: from the new Apple account to TestFlight

The first TestFlight build of Prydd, under the EntrypointLabs Apple team with the
bundle ID `com.entrypointlabs.prydd` ([ADR-0037](../adr/0037-ios-app-id-under-the-entrypointlabs-apple-team.md)).
The EAS project stays `gifted-borg/xend`.

Part 1 is console work only a person can do, and part 2 is commands for whoever
runs the build, a person or an agent session. Part 3 is what the build needs to
actually work in testers' hands; it can happen alongside part 2.

## 1. Console steps (a person, in a browser)

### 1.1 Note the team

developer.apple.com → Account → Membership details. Write down the **Team ID**
(ten characters) and the entity type: Organization or Individual.

### 1.2 Register the App ID

Certificates, Identifiers & Profiles → Identifiers → **+** → App IDs → App.

- Bundle ID: **Explicit**, `com.entrypointlabs.prydd`
- Description: `Prydd`

Leave the capabilities alone. EAS turns on what the app's entitlements need
(Push Notifications, Sign in with Apple, Associated Domains, App Attest) when it
creates the provisioning profile.

### 1.3 Create the App Store Connect record

App Store Connect → Apps → **+** → New App.

- Platforms: iOS
- Name: `Prydd`. Names are unique across the App Store; if it is taken, use a
  variant. It can change any time before release.
- Bundle ID: `com.entrypointlabs.prydd` (from 1.2)
- SKU: `prydd-ios`
- User access: Full Access

Then App Information → General Information → **Apple ID**. That number is
`ASC_APP_ID`.

### 1.4 Create an App Store Connect API key

Users and Access → Integrations → App Store Connect API → **Team Keys** → **+**.
The first time, the Account Holder has to request API access on that page.

- Name: `EAS`
- Access: **Admin**. EAS creates the distribution certificate with this key, and
  Apple allows that for Admin keys only.

Download the `.p8` file. Apple offers it **once**. Note the **Key ID** (in the
row) and the **Issuer ID** (above the table).

### 1.5 Set up internal testing

App Store Connect → the app → TestFlight → Internal Testing → **+**. Create a
group, add testers (anyone with an App Store Connect role) and turn on automatic
distribution, so each new build reaches them without a manual step. Internal
testing needs no Beta App Review.

### 1.6 Create an Expo access token

expo.dev, signed in as an owner of `gifted-borg` → Account settings → Access
tokens → Create.

### 1.7 Hand the session what it needs

The cloud environment menu in the session's title bar → Edit. Changes reach the
**next** session, not one that is already running.

Network access, allowed domains:

```
expo.dev
api.expo.dev
exp.host
appstoreconnect.apple.com
api.appstoreconnect.apple.com
```

Secrets (or environment variables, if the environment has no secrets section):

| Name                         | Value                                                                |
| ---------------------------- | -------------------------------------------------------------------- |
| `EXPO_TOKEN`                 | The token from 1.6                                                   |
| `EXPO_APPLE_TEAM_ID`         | The Team ID from 1.1                                                 |
| `EXPO_APPLE_TEAM_TYPE`       | `COMPANY_OR_ORGANIZATION`, or `INDIVIDUAL`                           |
| `EXPO_ASC_KEY_ID`            | The Key ID from 1.4                                                  |
| `EXPO_ASC_ISSUER_ID`         | The Issuer ID from 1.4                                               |
| `EXPO_ASC_API_KEY_P8_BASE64` | The `.p8` as one line: `base64 -i AuthKey_<KEY_ID>.p8 \| tr -d '\n'` |
| `ASC_APP_ID`                 | The Apple ID from 1.3                                                |

Base64, because an environment value is a single line and a `.p8` is not.

Then start a new session and point it at part 2 of this file.

## 2. The first build (commands)

From `apps/mobile`, on a branch that has this file.

### 2.1 Check access

```sh
curl -sS -o /dev/null -w "%{http_code}\n" https://api.expo.dev/graphql
umask 077
printf %s "$EXPO_ASC_API_KEY_P8_BASE64" | base64 -d > "$HOME/asc-api-key.p8"
export EXPO_ASC_API_KEY_PATH="$HOME/asc-api-key.p8"
npx eas-cli@latest whoami
```

`000` from curl means the domains in 1.7 are not allowed yet. `whoami` must name
an account with access to `gifted-borg/xend`.

### 2.2 Check the production environment on EAS

```sh
npx eas-cli@latest env:list --environment production --include-sensitive
```

A production build loads the `production` environment. It needs:

- `SENTRY_ORG` and `SENTRY_PROJECT`. `app.config.ts` refuses a production build
  without them.
- `SENTRY_AUTH_TOKEN`. The production profile uploads source maps.
- `EXPO_PUBLIC_PRIVY_APP_ID`, `EXPO_PUBLIC_PRIVY_CLIENT_ID`,
  `EXPO_PUBLIC_BACKEND_URL`, `EXPO_PUBLIC_SOLANA_CLUSTER`,
  `EXPO_PUBLIC_USDC_MINT_ADDRESS` and `EXPO_PUBLIC_SOLANA_RPC_URL`. See
  `apps/mobile/README.md`. The cluster, mint and RPC must agree
  (`docs/specs/dapp-store-resubmission.md`).

Add anything missing with `npx eas-cli@latest env:create --environment production`.

### 2.3 Point the submit profile at the app

In `apps/mobile/eas.json`, give `submit.production` an `ios` block with the
values from part 1. None of them is secret; the `.p8` stays out of git (`*.p8`
is in `.gitignore` and `.easignore`).

```json
"submit": {
  "production": {
    "ios": {
      "ascAppId": "<ASC_APP_ID>",
      "appleTeamId": "<EXPO_APPLE_TEAM_ID>",
      "ascApiKeyPath": "./asc-api-key.p8",
      "ascApiKeyId": "<EXPO_ASC_KEY_ID>",
      "ascApiKeyIssuerId": "<EXPO_ASC_ISSUER_ID>"
    }
  }
}
```

`ascApiKeyPath` is resolved against `apps/mobile`. Copy or link the key there for
a submission: `ln -sf "$HOME/asc-api-key.p8" ./asc-api-key.p8`. Commit the
`eas.json` change.

### 2.4 Create the signing credentials

A new Apple team has no distribution certificate, and eas-cli creates one only
in interactive mode. `scripts/eas-credentials-headless.py` gives it a
pseudo-terminal and confirms the generate-or-reuse prompts, and stops on any
other prompt.

```sh
python3 -I scripts/eas-credentials-headless.py -- \
  npx eas-cli@latest credentials:configure-build --platform ios --profile production
```

It ends with the distribution certificate and an App Store provisioning profile
stored on EAS, with the capabilities enabled on the App ID. A person with a
terminal can run the same `eas-cli` command directly and press Enter at each
prompt.

### 2.5 Build and submit

```sh
npx eas-cli@latest build --platform ios --profile production \
  --non-interactive --auto-submit --no-wait
```

This prints the build URL. The build takes about 20 minutes; the submission
starts on EAS when it finishes, whether or not the command is still waiting.
`autoIncrement` with the remote version source gives every build a new build
number, so a resubmission never collides.

Follow it with `npx eas-cli@latest build:view <build id>`.

### 2.6 Confirm it is in TestFlight

Apple processes an upload for 5 to 30 minutes before it can be tested:

```sh
node scripts/asc-builds.mjs
```

The build is done when its state reads `VALID`. The internal group from 1.5
then gets it automatically. `ITSAppUsesNonExemptEncryption: false` in
`app.json` answers the export-compliance question, so no build waits on
"Missing Compliance".

## 3. Registrations the app needs on iOS

The build installs without these, but sign-in, passkeys and the phone's key fail
on iOS until each one names the new ID. `<TEAM_ID>` is the Team ID from 1.1.

| Where                                                        | Change                                                                                                                       | Without it                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Privy dashboard → the app → Clients → the native client      | Add `com.entrypointlabs.prydd` to the allowed app identifiers                                                                | Privy refuses sign-in from the app         |
| `https://xend.global/.well-known/apple-app-site-association` | Add `<TEAM_ID>.com.entrypointlabs.prydd` to `webcredentials.apps` and to `applinks`                                          | Passkeys and universal links fail          |
| Backend environment                                          | `IOS_APP_ATTEST_APP_ID=<TEAM_ID>.com.entrypointlabs.prydd`                                                                   | Hardware-key enrolment on iOS fails closed |
| `EXPO_PUBLIC_BACKEND_URL` on EAS                             | A backend that testers' phones can reach while they test                                                                     | Every request fails                        |
| EAS credentials → iOS → Push Notifications                   | An APNs key for the new team: `npx eas-cli@latest credentials --platform ios`, or upload one from developer.apple.com → Keys | Push notifications never reach iOS         |

Android is unaffected and stays on `com.giftedborg.xend`.

## When something fails

| Symptom                                                             | Cause and fix                                                                                                                     |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `SENTRY_ORG and SENTRY_PROJECT are required for a production build` | Missing from the EAS production environment (2.2)                                                                                 |
| Source map upload fails during the build                            | `SENTRY_AUTH_TOKEN` missing or lacks project access                                                                               |
| `Credentials are not set up`                                        | 2.4 has not run against this Apple team                                                                                           |
| `eas-credentials-headless: unexpected prompt, stopping`             | eas-cli asked something new. Read the prompt; if it is safe, add it to `ANSWERS` in the script, otherwise answer it in a terminal |
| Provisioning profile lacks App Attest or another capability         | Enable it on the App ID (1.2) and rerun 2.4                                                                                       |
| Submission: `No suitable application records were found`            | `ascAppId` or the bundle ID on the App Store Connect record does not match (1.3, 2.3)                                             |
| Submission: `401` from App Store Connect                            | Key ID, Issuer ID and `.p8` do not belong together, or the key was revoked                                                        |
