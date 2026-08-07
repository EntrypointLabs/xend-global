import { useCallback, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useEmbeddedSolanaWallet } from "@privy-io/expo";

import { getSolanaConnection } from "@/utils/chainReads";
import { isUserCanceledSign } from "@/utils/signing";
import { isQuoteExpired, type SwapQuote } from "@/utils/swapQuote";
import {
  buildSwapTransaction,
  SwapTransactionError,
} from "@/utils/swapTransaction";

export type SwapOutcome =
  | { status: "submitted"; signature: string }
  | { status: "canceled" }
  | { status: "failed"; message: string };

/** Matches the reference integration; preflight rejects on a co-signed route. */
const SEND_OPTIONS = { skipPreflight: true, maxRetries: 3 } as const;

export function useExecuteSwap() {
  const embedded = useEmbeddedSolanaWallet();
  const [isExecuting, setIsExecuting] = useState(false);

  const execute = useCallback(
    async (quote: SwapQuote): Promise<SwapOutcome> => {
      const wallet = embedded.wallets?.[0];
      if (!wallet) return { status: "failed", message: "Wallet not ready" };

      // Checked here as well as on screen: a quote can lapse between the tap
      // and the passkey prompt being satisfied.
      if (isQuoteExpired(quote, Date.now())) {
        return { status: "failed", message: "Price expired, try again" };
      }

      setIsExecuting(true);
      try {
        const connection = getSolanaConnection();
        const payer = new PublicKey(wallet.address);
        const transaction = await buildSwapTransaction(
          quote,
          payer,
          connection
        );

        let signed;
        try {
          const provider = await wallet.getProvider();
          const result = await provider.request({
            method: "signTransaction",
            params: { transaction },
          });
          signed = result.signedTransaction;
        } catch (error) {
          if (isUserCanceledSign(error)) return { status: "canceled" };
          throw error;
        }

        const signature = await connection.sendRawTransaction(
          signed.serialize(),
          SEND_OPTIONS
        );
        return { status: "submitted", signature };
      } catch (error) {
        return { status: "failed", message: describe(error) };
      } finally {
        setIsExecuting(false);
      }
    },
    [embedded.wallets]
  );

  return { execute, isExecuting };
}

function describe(error: unknown): string {
  if (error instanceof SwapTransactionError) return error.message;
  const message = error instanceof Error ? error.message : "";
  // Chain errors are unreadable; the Consumer needs the outcome, not the log.
  if (/blockhash|expired|slippage/i.test(message)) {
    return "Price moved, try again";
  }
  if (/insufficient/i.test(message)) return "Not enough balance for fees";
  return "Swap didn't go through";
}
