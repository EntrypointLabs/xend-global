import { Connection, PublicKey } from "@solana/web3.js";
import {
  accounts,
  getPolicyPda,
  getProgramConfigPda,
  getSettingsPda,
  getSmartAccountPda,
} from "@sqds/smart-account";

import type { AccountAddresses } from "./types.js";

/** The account index every Account uses. Sub-accounts are not part of the model. */
const PRIMARY_ACCOUNT_INDEX = 0;

/**
 * Addresses for an Account, given the settings seed assigned at creation.
 *
 * The seed comes from a global counter in the program config, so an Account address
 * cannot be recomputed from its signer set. Persist the seed when you create one.
 */
export function deriveAccountAddresses(settingsSeed: bigint): AccountAddresses {
  const [settings] = getSettingsPda({ accountIndex: settingsSeed });
  const [vault] = getSmartAccountPda({
    settingsPda: settings,
    accountIndex: PRIMARY_ACCOUNT_INDEX,
  });
  return { settings, vault };
}

export function derivePolicyAddress(
  settings: PublicKey,
  policySeed: bigint,
): PublicKey {
  // The seed is a u64 on-chain and the SDK converts with `BigInt(policySeed)`,
  // but its type says `number`. Passing a bigint is correct and the cast is only
  // to satisfy the narrower declaration.
  return getPolicyPda({
    settingsPda: settings,
    policySeed: policySeed as unknown as number,
  })[0];
}

export interface ProgramConfig {
  treasury: PublicKey;
  creationFeeLamports: bigint;
  /** Global counter. The next Account created is assigned `seed + 1`. */
  smartAccountIndex: bigint;
}

export async function fetchProgramConfig(
  connection: Connection,
): Promise<ProgramConfig> {
  const [address] = getProgramConfigPda({});
  const config = await accounts.ProgramConfig.fromAccountAddress(
    connection,
    address,
  );
  return {
    treasury: config.treasury,
    creationFeeLamports: BigInt(config.smartAccountCreationFee.toString()),
    smartAccountIndex: BigInt(config.smartAccountIndex.toString()),
  };
}

/**
 * The seed the next created Account will be assigned. Racy by nature: another
 * creator can take it between the read and the send, so treat a creation failure as
 * a retry rather than an error.
 */
export function nextSettingsSeed(config: ProgramConfig): bigint {
  return config.smartAccountIndex + 1n;
}
