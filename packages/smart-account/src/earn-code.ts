import { PublicKey, type Connection } from "@solana/web3.js";
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
/** The reviewed program's canonical bytes, independent of reserved upgrade padding. */
export async function readEarnForwarderCode(
  connection: Connection,
  program: PublicKey,
): Promise<Uint8Array> {
  const info = await connection.getAccountInfo(program, "confirmed");
  if (
    !info?.executable ||
    !info.owner.equals(LOADER) ||
    info.data.length !== 36 ||
    info.data[0] !== 2
  )
    throw new Error("Earn forwarder is not deployed");
  const state = await connection.getAccountInfo(
    new PublicKey(info.data.slice(4, 36)),
    "confirmed",
  );
  if (
    !state ||
    !state.owner.equals(LOADER) ||
    state.data.length < 45 ||
    state.data[0] !== 3
  )
    throw new Error("Earn forwarder code unavailable");
  let end = state.data.length;
  while (end > 45 && state.data[end - 1] === 0) end--;
  return state.data.slice(45, end);
}

/**
 * The reviewed forwarder builds a deployment trusts, from a comma-separated
 * list of SHA-256 hex digests. Listing the current build and its reviewed
 * upgrade lets one app release work on either side of a Squad upgrade.
 * Anything that is not a 64-character lowercase digest is dropped.
 */
export function reviewedCodeHashes(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter((h) => /^[0-9a-f]{64}$/.test(h));
}
