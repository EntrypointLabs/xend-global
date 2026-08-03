import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { instructions, types } from "@sqds/smart-account";

import { deriveAccountAddresses } from "./pda.js";
import {
  ACCOUNT_THRESHOLD,
  SETTINGS_TIME_LOCK_SECONDS,
  type AccountAddresses,
  type SignerRole,
  type SignerSet,
} from "./types.js";

const { Permission, Permissions } = types;

/**
 * Permissions per role. `Initiate` proposes, `Vote` counts toward the threshold,
 * `Execute` finalises.
 *
 * Recovery gets `Vote` alone, but that is presentation rather than protection: a
 * vote-only signer still counts toward the threshold and can help spend through the
 * Settings consensus. Keeping recovery away from funds is the job of the policy
 * signer sets, not of this mask.
 */
const ROLE_PERMISSIONS: Record<SignerRole, number> = {
  primary: Permissions.all().mask,
  approval: Permissions.fromPermissions([Permission.Vote, Permission.Execute])
    .mask,
  recovery: Permissions.fromPermissions([Permission.Vote]).mask,
};

export class InvalidSignerSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSignerSetError";
  }
}

/**
 * An Account is only created with all three roles present and distinct. Two signers
 * cannot recover from the loss of either, and a duplicate address would let one
 * compromise satisfy the threshold on its own.
 */
export function assertSignerSet(signers: SignerSet): void {
  const roles = new Set(signers.map((s) => s.role));
  for (const required of ["primary", "approval", "recovery"] as const) {
    if (!roles.has(required)) {
      throw new InvalidSignerSetError(`missing the ${required} signer`);
    }
  }

  const addresses = new Set(signers.map((s) => s.address.toBase58()));
  if (addresses.size !== signers.length) {
    throw new InvalidSignerSetError("signer addresses must be distinct");
  }
}

export interface CreateAccountParams {
  signers: SignerSet;
  /** Pays rent and the creation fee. Not a signer on the resulting Account. */
  creator: PublicKey;
  treasury: PublicKey;
  /** From {@link nextSettingsSeed}. Assigned by a global counter, not derived. */
  settingsSeed: bigint;
  timeLockSeconds?: number;
  memo?: string;
}

export interface CreateAccountResult {
  instruction: TransactionInstruction;
  addresses: AccountAddresses;
}

/**
 * Builds the instruction creating an Account: threshold 2 of 3, autonomous, with a
 * time lock on settings changes.
 *
 * Autonomous means `settingsAuthority` is null, so no admin key can rewrite the
 * signer set out from under the Consumer. The time lock applies to settings changes
 * only. Spends run under policies, whose own time lock must be zero for synchronous
 * execution.
 */
export function buildCreateAccount({
  signers,
  creator,
  treasury,
  settingsSeed,
  timeLockSeconds = SETTINGS_TIME_LOCK_SECONDS,
  memo,
}: CreateAccountParams): CreateAccountResult {
  assertSignerSet(signers);

  const addresses = deriveAccountAddresses(settingsSeed);
  const instruction = instructions.createSmartAccount({
    treasury,
    creator,
    settings: addresses.settings,
    settingsAuthority: null,
    threshold: ACCOUNT_THRESHOLD,
    signers: signers.map((signer) => ({
      key: signer.address,
      permissions: { mask: ROLE_PERMISSIONS[signer.role] },
    })),
    timeLock: timeLockSeconds,
    rentCollector: null,
    memo,
  });

  return { instruction, addresses };
}
