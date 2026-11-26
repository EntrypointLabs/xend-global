import { useCallback, useEffect, useRef, useState } from "react";
import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEmbeddedSolanaWallet } from "@privy-io/expo";
import { useQueryClient } from "@tanstack/react-query";
import { Buffer } from "buffer";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
  checkEarnMessage,
  earnAsset,
  earnAssetByMint,
  TOKEN_PROGRAM_ID,
  WRAPPED_SOL_MINT,
  associatedTokenAddress,
  decodeAllowedPrograms,
  derivePolicyAddress,
  deriveVaultAddress,
  readEarnExchangeRate,
  readEarnForwarderCode,
  depositShares,
  sharesValue,
  sharesForValue,
  type EarnProviderId,
  type EarnAction,
} from "@prydd/smart-account";
import { useAccount } from "@/hooks/useAccount";
import { apiClient } from "@/utils/apiClient";
import { getSolanaConnection } from "@/utils/chainReads";
import { SIGN_PROMPT } from "@/modules/hardware-key/src";
import { signWithApprovalSigner } from "@/modules/hardware-key/src/turnkeySign";
import { readEarnApprovalOutcome } from "@/utils/earnRecovery";
import { isUserCanceledSign } from "@/utils/signing";

type Pending = {
  signed: string;
  signature?: string;
  lastValidBlockHeight?: number;
  provider: EarnProviderId;
  action: EarnAction;
};
type Outcome =
  | { status: "confirmed" }
  | { status: "pending" }
  | { status: "cancelled" }
  | { status: "failed"; message: string };
const publicProgram = process.env.EXPO_PUBLIC_EARN_FORWARDER_PROGRAM;
const publicCodeHash = process.env.EXPO_PUBLIC_EARN_FORWARDER_CODE_SHA256;
export function useExecuteEarn() {
  const { data: account } = useAccount();
  const embedded = useEmbeddedSolanaWallet();
  const queries = useQueryClient();
  const pending = useRef<Pending | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const locked = useRef(false);
  const [isExecuting, setExecuting] = useState(false);
  const [hasPending, setPending] = useState(false);
  const [ready, setReady] = useState(false);
  const storageKey = account ? `earn:pending:${account.address}` : null;
  useEffect(() => {
    let active = true;
    pending.current = null;
    setPending(false);
    setReady(false);
    if (storageKey)
      void AsyncStorage.getItem(storageKey)
        .then((raw) => {
          if (!active) return;
          if (raw) {
            const parsed = JSON.parse(raw) as Pending;
            if (
              typeof parsed.signed === "string" &&
              parsed.signed.length < 2000
            ) {
              pending.current = parsed;
              setPending(true);
            }
          }
          setReady(true);
        })
        .catch(() => {
          if (active) setReady(false);
        });
    return () => {
      active = false;
    };
  }, [storageKey]);
  const execute = useCallback(
    async (
      provider: EarnProviderId,
      action: EarnAction,
      amount: number,
      withdrawAll = false,
      /** The token being lent; USDC when absent. `amount` is in its units. */
      mint?: string
    ): Promise<Outcome> => {
      if (locked.current) return { status: "pending" };
      if (!account || !storageKey || !ready)
        return { status: "failed", message: "Your Account is not ready yet" };
      const wallet = embedded.wallets?.find(
        (w) => w.address === account.signers.primary
      );
      if (!wallet)
        return { status: "failed", message: "Your Account is not ready yet" };
      locked.current = true;
      setExecuting(true);
      const rpc = getSolanaConnection();
      const clear = async () => {
        await AsyncStorage.removeItem(storageKey);
        pending.current = null;
        setPending(false);
      };
      const save = async (p: Pending) => {
        await AsyncStorage.setItem(storageKey, JSON.stringify(p));
        pending.current = p;
        setPending(true);
      };
      try {
        if (!pending.current) {
          if (!publicProgram || !publicCodeHash)
            throw new Error("Earn is not available in this build yet");
          const asset = mint ? earnAssetByMint(mint) : "USDC";
          if (!asset) throw new Error("Earn is not available for this token");
          const lent = earnAsset(provider, asset);
          const minor = Math.round(amount * 10 ** lent.decimals);
          if (!Number.isSafeInteger(minor) || minor <= 0)
            throw new Error("Choose a valid amount");
          const quote = await apiClient.quoteEarn(
            provider,
            action,
            String(minor),
            withdrawAll,
            mint
          );
          if (
            quote.provider !== provider ||
            quote.action !== action ||
            quote.amountMinor !== String(minor) ||
            (mint !== undefined && quote.mint !== mint) ||
            quote.expiresAt * 1000 <= Date.now()
          )
            throw new Error("The estimate changed. Try again.");
          const prepared = await apiClient.prepareEarn(quote.quoteId);
          if (
            JSON.stringify(prepared.quote) !== JSON.stringify(quote) ||
            prepared.forwarderProgram !== publicProgram
          )
            throw new Error("This request did not match what you approved");
          const settings = new PublicKey(prepared.settingsAddress),
            vault = new PublicKey(account.address),
            policy = derivePolicyAddress(settings, 2n);
          if (!deriveVaultAddress(settings).equals(vault))
            throw new Error("This request did not match your Account");
          // The server repays the sponsor wrapped-SOL rent only for an account
          // it opens, so this phone reads the same fact before rebuilding.
          const [price, policyInfo, wrappedSol] = await Promise.all([
            readEarnExchangeRate(rpc, provider, asset),
            rpc.getAccountInfo(policy),
            asset === "SOL"
              ? rpc.getAccountInfo(
                  associatedTokenAddress(
                    vault,
                    WRAPPED_SOL_MINT,
                    TOKEN_PROGRAM_ID
                  )
                )
              : Promise.resolve(null),
          ]);
          if (!policyInfo) throw new Error("Your Account is not ready yet");
          const input = BigInt(quote.inputAmountRaw),
            minimum = BigInt(quote.minimumOutRaw),
            approved = BigInt(minor);
          if (action === "deposit") {
            if (
              input !== approved ||
              minimum < (depositShares(approved, price) * 9950n) / 10000n
            )
              throw new Error("The estimate changed. Try again.");
          } else if (
            input > (sharesForValue(approved, price) * 10050n) / 10000n + 1n ||
            minimum < (approved * 9950n) / 10000n ||
            sharesValue(input, price) > (approved * 10050n) / 10000n + 1n
          )
            throw new Error("The estimate changed. Try again.");
          if (withdrawAll) {
            const holding = await rpc.getTokenAccountBalance(
              associatedTokenAddress(vault, lent.receipt, lent.tokenProgram)
            );
            if (action !== "redeem" || BigInt(holding.value.amount) !== input)
              throw new Error("Your position changed. Try again.");
          }
          const code = await readEarnForwarderCode(
            rpc,
            new PublicKey(publicProgram)
          );
          const digest = await Crypto.digest(
            Crypto.CryptoDigestAlgorithm.SHA256,
            new Uint8Array(code)
          );
          const hash = Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          if (hash !== publicCodeHash)
            throw new Error("Earn is temporarily unavailable");
          const tx = VersionedTransaction.deserialize(
            Buffer.from(prepared.unsignedTxBase64, "base64")
          );
          const tables = await Promise.all(
            tx.message.addressTableLookups.map(async (lookup) => {
              const table = await rpc.getAddressLookupTable(lookup.accountKey);
              if (!table.value)
                throw new Error("The request expired. Try again.");
              return table.value;
            })
          );
          const reason = checkEarnMessage(
            prepared.unsignedTxBase64,
            {
              provider,
              asset,
              action,
              amount: input,
              minimumOut: minimum,
              addresses: { settings, vault },
              policy,
              signers: [
                new PublicKey(account.signers.primary),
                new PublicKey(account.signers.approval),
              ],
              allowedPrograms: decodeAllowedPrograms(policy, policyInfo),
              feePayer: tx.message.staticAccountKeys[0],
              forwarderProgram: new PublicKey(publicProgram),
              wrappedSolAccountExists: !!wrappedSol,
            },
            tables
          );
          if (reason)
            throw new Error("This request did not match what you approved");
          if (
            (await rpc.getBlockHeight("confirmed")) >
            prepared.lastValidBlockHeight
          )
            throw new Error("The estimate expired. Try again.");
          if (!live.current) return { status: "cancelled" };
          let signedHex: string;
          try {
            signedHex = await signWithApprovalSigner({
              organizationId: account.approvalSubOrgId,
              signWith: account.signers.approval,
              unsignedTransaction: Buffer.from(tx.serialize()).toString("hex"),
              prompt: SIGN_PROMPT.earn,
            });
          } catch (error) {
            if (isUserCanceledSign(error)) return { status: "cancelled" };
            throw error;
          }
          if (!live.current) return { status: "cancelled" };
          const providerApi = await wallet.getProvider();
          const { signedTransaction } = await providerApi.request({
            method: "signTransaction",
            params: {
              transaction: VersionedTransaction.deserialize(
                Buffer.from(signedHex, "hex")
              ),
            },
          });
          if (!live.current) return { status: "cancelled" };
          await save({
            signed: Buffer.from(signedTransaction.serialize()).toString(
              "base64"
            ),
            provider,
            action,
            lastValidBlockHeight: prepared.lastValidBlockHeight,
          });
        }
        if (!live.current) return { status: "pending" };
        const stored = pending.current!;
        {
          try {
            const result = await apiClient.submitEarn(stored.signed);
            await save({ ...stored, signature: result.signature });
          } catch (error) {
            const e = error as { data?: { code?: string; signature?: string } };
            if (e.data?.signature)
              await save({ ...stored, signature: e.data.signature });
            else if (
              e.data?.code === "EARN_QUOTE_EXPIRED" &&
              !stored.signature
            ) {
              await clear();
              throw new Error(
                "The approval expired. Check your balance before trying again."
              );
            } else if (!stored.signature) return { status: "pending" };
          }
        }
        const signature = pending.current?.signature;
        if (!signature) return { status: "pending" };
        // Never report success or change positions before chain confirmation.
        for (let i = 0; i < 12; i++) {
          const result = await readEarnApprovalOutcome(rpc, pending.current!);
          if (result === "expired") {
            await clear();
            await Promise.all([
              queries.invalidateQueries({ queryKey: ["earn"] }),
              queries.invalidateQueries({ queryKey: ["balances"] }),
              queries.invalidateQueries({ queryKey: ["transfers"] }),
            ]);
            return {
              status: "failed",
              message:
                "The approval expired without going through. Your balances have been refreshed. Try again.",
            };
          }
          if (result === "failed") {
            await clear();
            return {
              status: "failed",
              message:
                "The move did not go through. Your balance has not changed.",
            };
          }
          if (result === "confirmed") {
            await clear();
            void queries.invalidateQueries({ queryKey: ["earn"] });
            void queries.invalidateQueries({ queryKey: ["balances"] });
            void queries.invalidateQueries({ queryKey: ["transfers"] });
            return { status: "confirmed" };
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        return { status: "pending" };
      } catch (error) {
        return {
          status: "failed",
          message: pending.current
            ? "An earlier approval is still being checked. Check it before trying another amount."
            : error instanceof Error
              ? error.message
              : "Earn is unavailable right now",
        };
      } finally {
        locked.current = false;
        setExecuting(false);
      }
    },
    [account, embedded.wallets, queries, storageKey, ready]
  );
  return {
    execute,
    isExecuting,
    hasPending,
    ready,
    configured: !!publicProgram && !!publicCodeHash,
  };
}
