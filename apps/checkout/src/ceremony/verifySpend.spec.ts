import { describe, expect, it } from 'vitest';
import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  associatedTokenAddress,
  buildApproveSettingsChange,
  buildProvisionAccount,
  buildSpend,
  deriveAccountAddresses,
  derivePolicyAddress,
  SETTINGS_TIME_LOCK_SECONDS,
  TOKEN_PROGRAM_ID,
} from '@prydd/smart-account';

import { checkCheckoutSpend } from './verifySpend';

const USDC = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const addresses = deriveAccountAddresses(11n);
const spendingLimitPolicy = derivePolicyAddress(addresses.settings, 1n);
const aboveLimitPolicy = derivePolicyAddress(addresses.settings, 2n);
const feePayer = Keypair.generate().publicKey;
const primary = Keypair.generate().publicKey;
const approval = Keypair.generate().publicKey;
const merchant = Keypair.generate().publicKey;
const settlementAccount = associatedTokenAddress(
  merchant,
  USDC,
  TOKEN_PROGRAM_ID,
);

const expected = {
  signerAddress: primary.toBase58(),
  executionCluster: 'devnet',
  usdcSettlementRaw: '2500000',
  payoutWallet: merchant.toBase58(),
};

function compile(instructions: TransactionInstruction[]): string {
  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k',
    instructions,
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString(
    'base64',
  );
}

function payment(
  amount: bigint,
  options: {
    mint?: PublicKey;
    twoSignature?: boolean;
    to?: PublicKey;
  } = {},
): string {
  const to = options.to ?? merchant;
  return compile([
    buildSpend({
      addresses,
      request: {
        mint: options.mint ?? USDC,
        amount,
        destination: to,
        destinationTokenAccount: options.to
          ? associatedTokenAddress(to, USDC, TOKEN_PROGRAM_ID)
          : settlementAccount,
      },
      route: options.twoSignature
        ? {
            kind: 'two-signature',
            reason: 'exceeds-per-use',
            policy: aboveLimitPolicy,
          }
        : { kind: 'spending-limit', policy: spendingLimitPolicy },
      signers: options.twoSignature ? [primary, approval] : [primary],
      decimals: 6,
      tokenProgram: TOKEN_PROGRAM_ID,
    }),
  ]);
}

describe('checkCheckoutSpend', () => {
  it('accepts the Payment on the confirmation sheet', () => {
    expect(checkCheckoutSpend(payment(2_500_000n), expected)).toBeNull();
  });

  it('refuses a different amount', () => {
    expect(checkCheckoutSpend(payment(250_000_000n), expected)).toBe(
      'it sends a different amount',
    );
  });

  it('refuses a payment to a wallet the store did not publish', () => {
    const elsewhere = Keypair.generate().publicKey;
    expect(
      checkCheckoutSpend(payment(2_500_000n, { to: elsewhere }), expected),
    ).toBe('it pays someone other than the store');
  });

  it('refuses a different currency', () => {
    const other = Keypair.generate().publicKey;
    expect(
      checkCheckoutSpend(payment(2_500_000n, { mint: other }), expected),
    ).toBe('it sends a different currency');
  });

  it('refuses a Spend that is not under the Spending Limit', () => {
    expect(
      checkCheckoutSpend(payment(2_500_000n, { twoSignature: true }), expected),
    ).toBe('it is not a payment under your spending limit');
  });

  it('refuses a Spend counted for another key', () => {
    expect(
      checkCheckoutSpend(payment(2_500_000n), {
        ...expected,
        signerAddress: approval.toBase58(),
      }),
    ).toBe('it counts a key other than yours');
  });

  it('refuses a change to who controls the Account', () => {
    const { propose } = buildProvisionAccount({
      addresses,
      spendingLimitSeed: 1n,
      aboveLimitSeed: 2n,
      terms: {
        mint: USDC,
        maxPerUse: 100_000_000n,
        maxPerPeriod: 100_000_000n,
        period: 'Daily',
        destinations: [],
      },
      primary,
      approval,
      proposer: primary,
      transactionIndex: 1n,
      timeLockSeconds: SETTINGS_TIME_LOCK_SECONDS,
    });
    expect(checkCheckoutSpend(compile(propose), expected)).toContain(
      'it is not a payment',
    );
  });

  it('refuses an approval of a staged change', () => {
    const vote = buildApproveSettingsChange({
      addresses,
      transactionIndex: 4n,
      signer: primary,
    });
    expect(checkCheckoutSpend(compile([vote]), expected)).toContain(
      'it is not a payment',
    );
  });

  it('refuses a network it has no USDC for', () => {
    expect(
      checkCheckoutSpend(payment(2_500_000n), {
        ...expected,
        executionCluster: 'testnet',
      }),
    ).toBe('it is for a network this checkout does not pay on');
  });
});
