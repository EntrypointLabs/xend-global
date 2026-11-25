/** Read-only mainnet fixtures; no signer or funded test transaction. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import {
  EARN_PROVIDERS,
  EARN_USDC,
  earnProviderAccounts,
} from "../../src/earn.js";
const target = join(import.meta.dirname, "earn");
mkdirSync(target, { recursive: true });
const rpc = new Connection(
  // eslint-disable-next-line turbo/no-undeclared-env-vars -- read-only fixture fetcher, not a cached build task
  process.env.HELIUS_RPC_URL ?? "https://api.mainnet-beta.solana.com",
  "confirmed",
);
const ids = [
  EARN_PROVIDERS.kamino.program,
  EARN_PROVIDERS.jupiter.program,
  "jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC",
];
try {
  for (const id of ids) {
    const program = await rpc.getAccountInfo(new PublicKey(id));
    if (!program) throw new Error("Missing program");
    const data = await rpc.getAccountInfo(
      new PublicKey(program.data.subarray(4, 36)),
    );
    if (!data) throw new Error("Missing program data");
    writeFileSync(join(target, `${id}.so`), data.data.subarray(45));
  }
  const keys = new Map<string, PublicKey>([
    [EARN_USDC.toBase58(), EARN_USDC],
    [SYSVAR_CLOCK_PUBKEY.toBase58(), SYSVAR_CLOCK_PUBKEY],
  ]);
  for (const provider of ["kamino", "jupiter"] as const) {
    for (const action of ["deposit", "redeem"] as const) {
      for (const a of earnProviderAccounts(provider, action, PublicKey.default))
        keys.set(a.pubkey.toBase58(), a.pubkey);
    }
  }
  const addresses = [...keys.values()];
  const state = await rpc.getMultipleAccountsInfoAndContext(addresses);
  writeFileSync(
    join(target, "accounts.json"),
    JSON.stringify(
      {
        slot: state.context.slot,
        accounts: state.value.flatMap((info, i) =>
          info
            ? [
                {
                  address: addresses[i]!.toBase58(),
                  owner: info.owner.toBase58(),
                  lamports: info.lamports,
                  executable: info.executable,
                  data: info.data.toString("base64"),
                },
              ]
            : [],
        ),
      },
      null,
      2,
    ),
  );
  console.log(`Saved chain snapshot at slot ${state.context.slot}`);
} catch {
  console.error(
    "Could not fetch Earn fixtures. Check RPC access; no transactions were sent.",
  );
  process.exitCode = 1;
}
