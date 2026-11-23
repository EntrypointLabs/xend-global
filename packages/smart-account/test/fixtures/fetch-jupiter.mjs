/*
 * Snapshots two live Jupiter routes, and every account they touch, so the swap
 * suite can execute them from a Squads vault in LiteSVM.
 *
 *   RPC_URL=<mainnet rpc> node test/fixtures/fetch-program.mjs
 *   RPC_URL=<mainnet rpc> node test/fixtures/fetch-jupiter.mjs
 *
 * Jupiter only exists on mainnet, so both fixtures have to come from there:
 * the routes are built for the vault the next Account would get, which is
 * derived from the program config the first script wrote.
 *
 * A route is priced against pool state at one moment and expires with it, so
 * the snapshot is the state rather than a recording of calls. Artifacts are
 * gitignored and the suite skips without them.
 */
import { Buffer } from "node:buffer";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Connection, PublicKey } from "@solana/web3.js";
import {
  accounts,
  getSettingsPda,
  getSmartAccountPda,
} from "@sqds/smart-account";

const here = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.RPC_URL;
if (!RPC) throw new Error("set RPC_URL to a mainnet RPC");
const JUPITER_API = process.env.JUPITER_API_URL ?? "https://lite-api.jup.ag";

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const PROGRAM_DATA_HEADER = 45;

const connection = new Connection(RPC, "confirmed");

const config = JSON.parse(
  readFileSync(join(here, "program-config.json"), "utf8"),
);
const [{ smartAccountIndex }] = accounts.ProgramConfig.fromAccountInfo({
  data: Buffer.from(config.data, "base64"),
});
const settingsSeed = BigInt(smartAccountIndex.toString()) + 1n;
const [settings] = getSettingsPda({ accountIndex: settingsSeed });
const [vault] = getSmartAccountPda({ settingsPda: settings, accountIndex: 0 });

async function jupiter(path, init) {
  const response = await globalThis.fetch(`${JUPITER_API}${path}`, init);
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(`${path}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

async function snapshot(name, inputMint, outputMint, amount) {
  // One venue with plain pool accounts. Proprietary market makers read state
  // that goes stale within a few slots, which a frozen snapshot cannot keep up.
  const quote = await jupiter(
    `/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
      `&amount=${amount}&slippageBps=100&onlyDirectRoutes=true` +
      `&dexes=${encodeURIComponent(process.env.JUPITER_DEXES ?? "Whirlpool")}`,
  );
  const built = await jupiter("/swap/v1/swap-instructions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: vault.toBase58(),
      useSharedAccounts: true,
      wrapAndUnwrapSol: false,
    }),
  });

  const route = built.swapInstruction;
  const wanted = new Set([
    route.programId,
    inputMint,
    outputMint,
    ...route.accounts.map((a) => a.pubkey),
    ...built.addressLookupTableAddresses,
  ]);
  // The vault's own accounts are written by the suite, not copied.
  wanted.delete(vault.toBase58());

  const addresses = [...wanted];
  const { context, value } = await connection.getMultipleAccountsInfoAndContext(
    addresses.map((a) => new PublicKey(a)),
  );
  const blockTime = await connection.getBlockTime(context.slot);

  const copied = [];
  const programs = [];
  for (const [i, info] of value.entries()) {
    if (!info) continue;
    const address = addresses[i];
    if (info.executable && info.owner.toBase58() === UPGRADEABLE_LOADER) {
      const programData = await connection.getAccountInfo(
        new PublicKey(info.data.subarray(4, 36)),
      );
      programs.push({
        address,
        elf: programData.data.subarray(PROGRAM_DATA_HEADER).toString("base64"),
      });
      continue;
    }
    if (info.executable) continue;
    copied.push({
      address,
      owner: info.owner.toBase58(),
      lamports: info.lamports,
      data: info.data.toString("base64"),
    });
  }

  mkdirSync(join(here, "jupiter"), { recursive: true });
  writeFileSync(
    join(here, "jupiter", `${name}.json`),
    JSON.stringify({
      settingsSeed: settingsSeed.toString(),
      vault: vault.toBase58(),
      slot: context.slot,
      unixTimestamp: blockTime,
      inputMint,
      outputMint,
      amountIn: quote.inAmount,
      quotedAmountOut: quote.outAmount,
      slippageBps: quote.slippageBps,
      venue: quote.routePlan.map((step) => step.swapInfo.label).join(" > "),
      route,
      lookupTables: built.addressLookupTableAddresses,
      accounts: copied,
      programs,
    }),
  );
  console.log(
    `${name.padEnd(12)} ${quote.routePlan[0].swapInfo.label}  ` +
      `${copied.length} accounts, ${programs.length} programs, slot ${context.slot}`,
  );
}

console.log(`vault ${vault.toBase58()} (settings seed ${settingsSeed})`);
await snapshot("usdc-to-sol", USDC, WRAPPED_SOL, "100000000");
await snapshot("sol-to-usdc", WRAPPED_SOL, USDC, "1000000000");
