import './bufferPolyfill';
import { Buffer } from 'buffer';
import {
  associatedTokenAddress,
  describeTransaction,
  TOKEN_PROGRAM_ID,
} from '@prydd/smart-account';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';

const USDC_MINT: Record<string, string> = {
  devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'mainnet-beta': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};

export interface ExpectedCheckoutSpend {
  /** The key asked to sign, which must be the only one the Spend counts. */
  signerAddress: string;
  executionCluster: string;
  /** The amount on the confirmation sheet, in USDC's smallest units. */
  usdcSettlementRaw: string;
  /** The wallet the store publishes on its own site. */
  payoutWallet: string;
}

export class CheckoutSpendMismatchError extends Error {
  constructor(readonly reason: string) {
    super(`the payment did not match what was shown: ${reason}`);
    this.name = 'CheckoutSpendMismatchError';
  }
}

/**
 * Returns the reason the Spend the backend built does not match the Payment
 * on screen, or null when it does.
 *
 * The page signs with the Account's primary key, which on its own can also
 * propose and approve changes to who controls the Account. So the message is
 * held to the one thing a checkout ever signs: a single Spend under the
 * Spending Limit, of exactly this amount, in USDC, counting only this key.
 *
 * The page is never told which Account the money leaves, so every key in the
 * message is tried as the vault. Only the one the Spend actually draws on
 * describes as a Spend; the key cannot sign for an Account it is not on.
 */
export function checkCheckoutSpend(
  unsignedTxBase64: string,
  expected: ExpectedCheckoutSpend,
): string | null {
  const mint = USDC_MINT[expected.executionCluster];
  if (!mint) return 'it is for a network this checkout does not pay on';

  let keys: PublicKey[];
  try {
    keys = VersionedTransaction.deserialize(
      Buffer.from(unsignedTxBase64, 'base64'),
    ).message.staticAccountKeys;
  } catch {
    return 'it could not be read';
  }

  let lastReason = 'it is not a payment';
  for (const vault of keys) {
    const description = describeTransaction(unsignedTxBase64, {
      addresses: { vault },
    });
    if (description.kind !== 'spend') {
      if (description.kind === 'unknown') lastReason = description.reason;
      continue;
    }
    if (description.route !== 'spending-limit') {
      return 'it is not a payment under your spending limit';
    }
    const signers = description.signers.map((s) => s.toBase58());
    if (signers.length !== 1 || signers[0] !== expected.signerAddress) {
      return 'it counts a key other than yours';
    }
    if (description.mint === 'SOL' || description.mint.toBase58() !== mint) {
      return 'it sends a different currency';
    }
    if (description.amount !== BigInt(expected.usdcSettlementRaw)) {
      return 'it sends a different amount';
    }
    if (
      description.destination &&
      description.destination.toBase58() !== expected.payoutWallet
    ) {
      return 'it pays someone other than the store';
    }
    const storeAccount = associatedTokenAddress(
      new PublicKey(expected.payoutWallet),
      description.mint,
      TOKEN_PROGRAM_ID,
    );
    if (!description.destinationTokenAccount?.equals(storeAccount)) {
      return 'it pays someone other than the store';
    }
    return null;
  }
  return `it is not a payment (${lastReason})`;
}

export function assertCheckoutSpend(
  unsignedTxBase64: string,
  expected: ExpectedCheckoutSpend,
): void {
  const reason = checkCheckoutSpend(unsignedTxBase64, expected);
  if (reason) throw new CheckoutSpendMismatchError(reason);
}
