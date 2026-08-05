# dApp Store resubmission

## Why the first submission was rejected

> We could not verify one or more core features described in the listing. Please
> make sure the app's primary functionality is available and working during review.

The cause was a **network mismatch**, not an outage. The reviewer deposited roughly
0.75 USDC on **mainnet**. The shipped build was configured for **devnet**, so the app
was watching a different chain entirely and the deposit never appeared. Nothing in the
listing said the app was on a test network, so from the reviewer's side the core
feature simply did not work.

A first diagnosis blamed the backend tunnel returning 502. That was wrong: the tunnel
was up during review. It is still a real fragility (see "Still outstanding"), just not
this.

## The landmine that caused it

Every network value fell back to devnet when its environment variable was unset:

```ts
process.env.EXPO_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
```

So a production build with an unset variable pointed at a test network while looking
completely normal. Nothing failed, nothing warned, and the balance just read zero.

`apps/mobile/utils/cluster.ts` now **defaults to mainnet** instead. Failing safe means
defaulting to the network where the money actually is; a developer who wants devnet
asks for it with `EXPO_PUBLIC_SOLANA_CLUSTER=devnet`. If the configured USDC mint
belongs to the other network, it is rejected with a loud console error rather than
silently honoured.

## What changed

|                          | Before           | After                                |
| ------------------------ | ---------------- | ------------------------------------ |
| EAS production USDC mint | devnet `4zMMC9…` | mainnet `EPjFWdd5…`                  |
| EAS production cluster   | unset, so devnet | `EXPO_PUBLIC_SOLANA_CLUSTER=mainnet` |
| Backend `SOLANA_CLUSTER` | devnet           | mainnet                              |
| Backend Helius RPC       | devnet           | mainnet                              |
| Mobile `.env`            | devnet mint      | mainnet mint                         |

Devnet configuration is backed up at `apps/backend/.env.devnet.bak` and
`apps/mobile/.env.devnet.bak`. **The backend must be restarted to pick this up.**

Verified against mainnet directly: the USDC mint reads back with 6 decimals, and both
RPC calls the app makes (`getParsedTokenAccountsByOwner`, `getSignaturesForAddress`)
return live mainnet data.

### One source of truth for the mint

Four modules independently read `EXPO_PUBLIC_USDC_MINT_ADDRESS` and could disagree,
which surfaced as the Consumer's spending balance appearing under Investments. They
all now call `getUsdcMint()`. It is a function rather than a constant because the
tests vary the environment at runtime.

### Investments and Earn are real screens

Both were "Coming soon" toasts. Since the listing describes them, an unbuilt feature
is itself an unverifiable core feature, which is the exact rejection reason.

- **Investments** (`app/investments/index.tsx`) lists every non-USDC holding, derived
  from the same balances the Cash screen reads. Empty state matches the Fuse
  reference.
- **Earn** (`app/earn/index.tsx`) shows the position, Lifetime Earned and Last 7D, and
  the Kamino lending product. Deposits are not wired, so the position is a genuine
  zero rather than a placeholder.

### Chain-direct fallback

Balances and Activity fall back to Solana RPC when the backend is unreachable, and a
failed backend exchange no longer strands a Consumer at the OTP screen: Privy has
already authenticated them and provisioned the wallet, so they continue on a degraded
session while the existing refresh effect retries.

This does not fix the rejection, but a wallet whose home screen blanks when one server
is down is the wrong shape for a dApp Store app regardless.

## Still outstanding, and these need a human

1. **The backend runs on an ngrok free tunnel from a laptop.** It was up during review
   and is up now, but the URL is in EAS production config and a free tunnel is not
   something to ship against. There is no deploy pipeline; the backend needs Postgres,
   Redis and Kafka. This is the largest remaining risk to a resubmission.
2. **Re-read the listing copy against what the app actually does.** The rejection was
   about the gap between the two, and the listing lives in the publisher portal rather
   than in this repo. The in-app surface now advertises only Cash, Investments and Earn.
3. **Three surfaces look real and do nothing.** This is the same shape as the original
   rejection, so it is a judgement call rather than an oversight:
   - **Xend Card** is back in the home grid by request, and raises a "coming soon"
     toast.
   - **Swap** has a complete screen and a working keypad, but Review raises "Swap
     quotes open soon". No quote provider is wired.
   - **Earn Deposit** opens the Receive modal rather than depositing into Kamino.

   A reviewer who taps any of them finds nothing behind it. Whether that matters
   depends entirely on the listing copy: a feature the listing does not claim is a
   teaser, and a feature it does claim is the rejection reason repeating. Reconciling
   the two is item 2 above and it needs the portal.

4. **Supply the token logos.** Kamino, SOL and USDC render as letter-in-a-circle
   placeholders because no artwork exists in the repo. Most visible on the Swap token
   pills, where they sit beside otherwise finished chrome.

## Decisions taken

**Client RPC: stay on the public mainnet endpoint.** It rate-limits (a 429 on a single
call during testing), but the backend is the primary path and already runs Helius with
failover server-side (`apps/backend/src/solana/failover-solana-rpc.ts`). The client RPC
serves only SNS resolution and the offline fallback. Embedding a Helius key would put it
inside the APK where it can be extracted and its quota burned, a worse trade than a
rate-limited fallback. Revisit with a usage-capped key or a backend RPC proxy if
fallback reads become load-bearing.

**Xend Card: kept in the home action grid.** It was removed as an unverifiable feature,
then restored by request: the grid reads as incomplete with three tiles, and the card is
a real part of the product story. It still only raises a "Coming soon" toast, which is
tracked as a risk above rather than treated as settled.

**Home grid borders track funding.** A section with nothing in it keeps a dashed border;
once it holds a balance the border closes to solid. Cash follows USDC, Investments any
non-USDC holding, Earn the position. The Card has no balance to track, so it stays
dashed until cards exist.

## Creating the submission

The CLI is portal-backed now, not raw NFT minting:

```sh
DAPP_STORE_API_KEY=<portal key> npx @solana-mobile/dapp-store-cli \
  --apk-file <path to the built APK> \
  --keypair <path to the Solana signer> \
  --whats-new "Xend now runs on Solana mainnet, so deposits, sends and activity reflect real balances. Investments and Earn are live."
```

The portal decides whether this lands as a first release or an update, and the app must
already exist there with its App NFT, which it does.

**Two secrets gate this and neither is on the build machine:** the portal API key
(`DAPP_STORE_API_KEY`, from the publisher portal) and the Solana signer keypair. Both
are held by the publisher. Everything else is ready.

## Two build traps that cost several hours

Both produced `errored` builds after multi-hour queue waits, which reads like a queue
timeout and is not. Neither was catchable by typecheck, lint or tests.

### `.easignore` replaces `.gitignore`, it does not extend it

Adding a small `.easignore` to exclude a couple of stray directories silently stopped
`node_modules`, `android/` and `ios/` being excluded. The upload went from 32 MB to
**1.9 GB** and failed. Anything `.gitignore` excludes has to be repeated in
`.easignore`; the file now says so at the top.

### An undeclared import can pass every local check

`utils/chainReads.ts` imported `@solana/spl-token`, which is **not** in
`apps/mobile/package.json`. It resolved locally only because it was an **extraneous**
transitive dependency of `@sqds/smart-account`, a package belonging to another branch
and left in `node_modules` across a branch switch. On a clean builder it does not
exist, so Metro failed in the Bundle JavaScript phase.

Typecheck, lint, jest and even `expo export` all passed, because all four ran against
the contaminated `node_modules`.

The offending code (`prepareTransferOnChain`, `submitTransferOnChain`) was never wired
into anything, so it was deleted rather than propped up with a new dependency.

**Check imports against declared dependencies before trusting a green local run:**

```sh
# every bare import in apps/mobile must appear in a package.json
npm ls <package>            # "extraneous" means it will not exist on the builder
```

`base64-js` also shows as undeclared in `app/(send)/confirm.tsx`, but it is a genuine
transitive dependency of `@bonfida/spl-name-service` and hoists on a clean install.
Undeclared-but-transitive works; undeclared-and-extraneous does not.

### Getting the real error out of EAS

`eas build:view` does not show it. The GraphQL API does:

```sh
SECRET=$(python3 -c "import json;print(json.load(open('$HOME/.expo/state.json'))['auth']['sessionSecret'])")
curl -s -X POST https://api.expo.dev/graphql \
  -H "expo-session: $SECRET" -H "Content-Type: application/json" \
  -d '{"query":"query{builds{byId(buildId:\"<id>\"){status error{errorCode message}}}}"}'
```

### Never run `eas build --local` casually

It fetches the production signing keystore to the machine. If build output is
redirected to a file, the keystore and its passwords land there in plaintext.
