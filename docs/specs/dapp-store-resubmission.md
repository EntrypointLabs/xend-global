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
2. **The client RPC is the public mainnet endpoint, which rate-limits.** It returned
   429 on a single call during testing. Helius works but its URL carries an API key,
   and `EXPO_PUBLIC_*` ships inside the APK where it can be extracted. Options are a
   usage-capped key, or an RPC proxy route on the backend. The backend already uses
   Helius server-side, so only the offline fallback and SNS lookups are affected.
3. **"Xend Card" is still a "Coming soon" toast** on the home screen. If the listing
   mentions a card, that is another feature a reviewer cannot verify. Either build it,
   remove the entry, or make sure the listing does not claim it.
4. **Re-read the listing copy against what the app actually does.** The rejection was
   about the gap between the two, and the listing lives in the publisher portal rather
   than in this repo.
