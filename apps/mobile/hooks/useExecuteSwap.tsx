import React, { useCallback, useState } from "react";
import { ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as Sentry from "@sentry/react-native";
import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import { Buffer } from "buffer";
import { fromByteArray, toByteArray } from "base64-js";
import {
  type AddressLookupTableAccount,
  VersionedTransaction,
  PublicKey,
} from "@solana/web3.js";
import {
  associatedTokenAddress,
  TOKEN_PROGRAM_ID,
  WRAPPED_SOL_MINT,
} from "@prydd/smart-account";

import { useAccount } from "@/hooks/useAccount";
import { SIGN_PROMPT } from "@/modules/hardware-key/src";
import { signWithApprovalSigner } from "@/modules/hardware-key/src/turnkeySign";
import { apiClient } from "@/utils/apiClient";
import { getSolanaConnection } from "@/utils/chainReads";
import { isUserCanceledSign } from "@/utils/signing";
import { isSwapQuoteExpired, type SwapQuote } from "@/utils/swap";
import { showToast } from "@/utils/toast";
import { checkSwap, MISMATCH_MESSAGE } from "@/utils/verifyTransaction";

export type SwapOutcome =
  | { status: "submitted"; signature: string }
  | { status: "canceled" }
  | { status: "failed"; message: string };

const PRICE_EXPIRED = "Price expired, try again";
const NOT_READY = "Your Account is not ready yet. Try again in a moment.";
const SOMETHING_WRONG = "Something went wrong. Nothing was swapped.";

const PRICE_MOVED_MESSAGE =
  "The price moved before the swap could start. Nothing was swapped. Check the new price and try again.";

const PREPARE_ERRORS: Record<string, string> = {
  QUOTE_EXPIRED: PRICE_EXPIRED,
  NO_ROUTE: "This swap would not go through right now. Nothing was swapped.",
  PRICE_MOVED: PRICE_MOVED_MESSAGE,
  SWAP_UNAVAILABLE: "Swap is unavailable right now",
  ACCOUNT_NEEDS_UPDATE: "Swap is not available on this Account yet",
};

/**
 * Swaps out of the Account: prepare, read it back, sign with both keys, submit.
 *
 * A swap is a Spend that pays the vault itself, and it always takes both of
 * the Account's keys. The approval signer goes first, behind the one biometric
 * the Consumer sees, because Turnkey takes a transaction unsigned and returns
 * it signed. The primary then fills its own slot from its session.
 *
 * The prepared message is read back before either key touches it. Both keys
 * are asked for on this phone, so nothing else would notice a swap that is not
 * the one priced on screen.
 */
export function useExecuteSwap() {
  const embedded = useEmbeddedSolanaWallet();
  const queryClient = useQueryClient();
  const { data: account } = useAccount();
  const [isExecuting, setIsExecuting] = useState(false);

  const execute = useCallback(
    async (quote: SwapQuote): Promise<SwapOutcome> => {
      const wallet = embedded.wallets?.[0];
      if (!wallet || !account) return { status: "failed", message: NOT_READY };

      // Checked here as well as on screen: a quote can lapse between the tap
      // and this running.
      if (isSwapQuoteExpired(quote, Date.now())) {
        return { status: "failed", message: PRICE_EXPIRED };
      }

      setIsExecuting(true);
      try {
        let prepared;
        try {
          prepared = await apiClient.prepareSwap(quote.quoteId);
        } catch (error) {
          const code = (error as { data?: { code?: string } })?.data?.code;
          const message = code && PREPARE_ERRORS[code];
          if (!message) throw error;
          // The price on screen is the one that just failed, so a fresh one
          // is fetched now instead of at the next refresh.
          if (code === "PRICE_MOVED" || code === "QUOTE_EXPIRED") {
            void queryClient.invalidateQueries({ queryKey: ["swapQuote"] });
          }
          return { status: "failed", message };
        }

        const unsigned = VersionedTransaction.deserialize(
          toByteArray(prepared.unsignedTxBase64)
        );
        const [lookupTables, wrappedSolAccountExists] = await Promise.all([
          loadLookupTables(unsigned),
          hasWrappedSolAccount(account.address),
        ]);
        const mismatch = checkSwap(
          prepared.unsignedTxBase64,
          {
            vault: account.address,
            signers: [account.signers.primary, account.signers.approval],
            inputMint: quote.inputMint,
            outputMint: quote.outputMint,
            amountInRaw: quote.amountInRaw,
            quotedAmountOutRaw: quote.outAmountRaw,
            slippageBps: quote.slippageBps,
            wrappedSolAccountExists,
          },
          lookupTables
        );
        if (mismatch) {
          Sentry.captureException(new Error(`swap mismatch: ${mismatch}`), {
            tags: { surface: "swap" },
          });
          return { status: "failed", message: MISMATCH_MESSAGE };
        }

        let signedBase64: string;
        try {
          const signedHex = await signWithApprovalSigner({
            organizationId: account.approvalSubOrgId,
            signWith: account.signers.approval,
            unsignedTransaction: Buffer.from(
              toByteArray(prepared.unsignedTxBase64)
            ).toString("hex"),
            prompt: SIGN_PROMPT.swap,
          });
          const provider = await wallet.getProvider();
          const { signedTransaction } = await provider.request({
            method: "signTransaction",
            params: {
              transaction: VersionedTransaction.deserialize(
                Buffer.from(signedHex, "hex")
              ),
            },
          });
          signedBase64 = fromByteArray(signedTransaction.serialize());
        } catch (error) {
          // A dismissed prompt is a decision, not a fault, and nothing has
          // been signed.
          if (isUserCanceledSign(error)) return { status: "canceled" };
          throw error;
        }

        const { signature } = await apiClient.submitSwap(signedBase64);
        followToOutcome(signature, queryClient);
        return { status: "submitted", signature };
      } catch (error) {
        Sentry.captureException(error, { tags: { surface: "swap" } });
        return { status: "failed", message: SOMETHING_WRONG };
      } finally {
        setIsExecuting(false);
      }
    },
    [embedded.wallets, account, queryClient]
  );

  return { execute, isExecuting };
}

const SWAP_TOAST_ID = "swap";
const SWAPPING_TOAST_MS = 25_000;
const OUTCOME_POLL_MS = 1_500;

/**
 * Reports how a broadcast swap ended, in the toast that said it started.
 *
 * Submitting is not settling: the price can move past the floor between the
 * two, and then the swap fails and nothing changes hands. So the toast says
 * Swapping until the chain says which it was, and says nothing further if the
 * chain has not answered by the time it would have gone away anyway.
 */
function followToOutcome(signature: string, queryClient: QueryClient) {
  showToast(
    "Swapping",
    <ActivityIndicator size="small" className="text-black" />,
    { id: SWAP_TOAST_ID, durationMs: SWAPPING_TOAST_MS }
  );

  void (async () => {
    const outcome = await waitForOutcome(
      signature,
      Date.now() + SWAPPING_TOAST_MS
    );
    queryClient.invalidateQueries({ queryKey: ["balances"] });
    queryClient.invalidateQueries({ queryKey: ["transfers"] });
    if (outcome === "landed") {
      showToast(
        "Swapped",
        <Ionicons name="checkmark-circle" size={16} className="text-success" />,
        { id: SWAP_TOAST_ID, tone: "success" }
      );
    } else if (outcome === "failed") {
      showToast(
        "Swap failed",
        <Ionicons name="close-circle" size={16} className="text-destructive" />,
        { id: SWAP_TOAST_ID, tone: "failed" }
      );
    }
  })();
}

async function waitForOutcome(
  signature: string,
  deadline: number
): Promise<"landed" | "failed" | "unknown"> {
  const connection = getSolanaConnection();
  while (Date.now() < deadline) {
    try {
      const { value } = await connection.getSignatureStatuses([signature]);
      const status = value[0];
      if (status?.err) return "failed";
      if (
        status?.confirmationStatus === "confirmed" ||
        status?.confirmationStatus === "finalized"
      ) {
        return "landed";
      }
    } catch {
      // A missed read says nothing about the swap; the next one might.
    }
    await new Promise((resolve) => setTimeout(resolve, OUTCOME_POLL_MS));
  }
  return "unknown";
}

/**
 * Whether the vault already has a wrapped SOL account, read from this phone's
 * own RPC. If it does, its rent is the Account's, and a swap that paid that
 * rent to the fee payer would be taking it.
 */
async function hasWrappedSolAccount(vault: string): Promise<boolean> {
  const account = associatedTokenAddress(
    new PublicKey(vault),
    WRAPPED_SOL_MINT,
    TOKEN_PROGRAM_ID
  );
  return (await getSolanaConnection().getAccountInfo(account)) !== null;
}

/**
 * The lookup tables a message names, read from this phone's own RPC rather
 * than taken from the backend: they decide which accounts the swap touches,
 * and the backend is the party being checked.
 */
async function loadLookupTables(
  transaction: VersionedTransaction
): Promise<AddressLookupTableAccount[]> {
  const connection = getSolanaConnection();
  const tables = await Promise.all(
    transaction.message.addressTableLookups.map((lookup) =>
      connection.getAddressLookupTable(lookup.accountKey)
    )
  );
  return tables
    .map((table) => table.value)
    .filter((table): table is AddressLookupTableAccount => table !== null);
}
