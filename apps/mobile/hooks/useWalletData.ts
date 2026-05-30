import { useState, useEffect, useCallback } from "react";
import { TransferResponse } from "@/types/Transaction";
import { EasClient } from "@/utils/easClient";
import { StorageService } from "@/utils/storage";
import { AUTH_STORAGE_KEYS } from "@/utils/auth";
import { AccountInfo } from "@/types/Auth";
import { useAuth } from "@/contexts/AuthContext";
import { useNewStack } from "@/utils/featureFlags";
import { apiClient, TokenBalance, TransferRow } from "@/utils/apiClient";

/**
 * Stablecoin mints that count toward the headline Balance per spec §5.5.
 * USDT is optional in dev (no canonical devnet mint); when unset, only USDC
 * contributes. The full `tokens` list is preserved on the backend response
 * so a future Investments view can render every mint without re-fetching.
 */
function getStablecoinMints(): Set<string> {
  const mints = new Set<string>();
  const usdc = process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS;
  const usdt = process.env.EXPO_PUBLIC_USDT_MINT_ADDRESS;
  if (usdc) mints.add(usdc);
  if (usdt) mints.add(usdt);
  return mints;
}

/**
 * Compute the headline Balance by summing the recognized stablecoin
 * balances (USDC + USDT). Returns a number rounded to 2 decimal places.
 * Uses BigInt to safely handle u64 raw amounts.
 */
function computeStablecoinTotal(tokens: TokenBalance[]): number {
  const stablecoinMints = getStablecoinMints();
  let total = 0;
  for (const t of tokens) {
    if (!stablecoinMints.has(t.mint)) continue;
    // amountRaw is a u64 integer string at `decimals` native decimals.
    // Convert via string→BigInt for safety, then to Number for display.
    // Stablecoin amounts in USD are well within safe-int range after
    // dividing by 10^decimals, so the eventual Number cast is safe.
    const raw = BigInt(t.amountRaw);
    const divisor = BigInt(10) ** BigInt(t.decimals);
    const whole = Number(raw / divisor);
    const fractionRaw = Number(raw % divisor);
    const fraction = fractionRaw / Number(divisor);
    total += whole + fraction;
  }
  // Round to 2dp the same way the legacy path did.
  return parseFloat(total.toFixed(2));
}

/**
 * Map a backend `TransferRow` (Phase 4 new-stack shape) to the legacy
 * mobile `TransferResponse` shape that `(tabs)/index.tsx` reads. The
 * Activity feed reads snake_case fields (`from_address`, `to_address`,
 * `confirmation_status`, `ui_amount`, `created_at`) inherited from the
 * Grid BFF passthrough; this mapping reproduces that shape so the screen
 * code stays untouched. Phase 5 deletes the legacy path AND modernises
 * the screen to camelCase in one pass.
 *
 * Direction translation:
 *   backend SEND  → legacy "outflow"  (Activity renders as "sent")
 *   backend RECEIVE → legacy "inflow" (Activity renders as "received")
 *
 * Status translation:
 *   backend PENDING/CONFIRMED/FAILED → legacy lowercase (Activity filters
 *   on "confirmed").
 */
function mapTransferRowToLegacy(row: TransferRow): any {
  const confirmation_status =
    row.status === "CONFIRMED"
      ? "confirmed"
      : row.status === "FAILED"
        ? "failed"
        : "pending";
  const direction = row.direction === "SEND" ? "outflow" : "inflow";
  // amountRaw is u64-as-string; derive a ui_amount string for display.
  // The Activity feed parses ui_amount via parseFloat, so we render with
  // up to 6 fractional digits (USDC) without trailing zeros.
  const raw = BigInt(row.amountRaw);
  // We do not know decimals from the backend row (the spec keeps `amountRaw`
  // intentionally decimal-less for the transfers table); default to 6
  // (USDC, USDT). The Activity feed today filters to USDC-mint rows only,
  // so this matches reality. Phase 5 should add `decimals` to TransferRow.
  const decimals = 6;
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = raw % divisor;
  const fractionStr = fraction.toString().padStart(decimals, "0");
  const uiAmount = `${whole.toString()}.${fractionStr}`.replace(/\.?0+$/, "");

  return {
    Spl: {
      id: row.id,
      gridUserId: "",
      mainAccountAddress: "",
      mint: row.mint,
      isToken2022: false,
      signature: row.signature ?? "",
      // snake_case fields for compatibility with the legacy Activity reader
      confirmation_status,
      from_address: row.fromAddress,
      to_address: row.toAddress,
      amount: row.amountRaw,
      ui_amount: uiAmount,
      decimals,
      confirmed_at: row.confirmedAt ?? undefined,
      created_at: row.createdAt,
      updated_at: row.confirmedAt ?? row.createdAt,
      direction,
    },
  };
}

export function useWalletData(accountInfo: AccountInfo | null) {
  const [isLoading, setIsLoading] = useState(false);
  const [balance, setBalance] = useState(0);
  const [transfers, setTransfers] = useState<TransferResponse>([]);
  const [error, setError] = useState<string | null>(null);
  const { user, wallet } = useAuth();
  const newStack = useNewStack();

  const fetchWalletData = useCallback(async () => {
    // Under the new stack the JWT — not `user.address` — is the
    // authentication signal. `wallet` (from AuthContext) is the Privy
    // embedded wallet address, which is `null` until the
    // `/auth/exchange` round-trip settles. Either signal indicates the
    // user is past login and ready to fetch.
    const hasIdentity = newStack
      ? Boolean(wallet) ||
        Boolean(user?.walletAddress) ||
        Boolean(user?.address)
      : Boolean(user?.address);
    if (!hasIdentity) {
      setError("Account info not found");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      if (newStack) {
        // New stack: fetch balances + transfers from our NestJS backend.
        // Both endpoints attach the Bearer JWT via apiClient internals.
        const [balancesResult, transfersResult] = await Promise.all([
          apiClient.getBalances(),
          apiClient.listTransfers({ limit: 50 }),
        ]);

        // Balance: sum USDC + USDT (when USDT mint is configured).
        const newBalance = computeStablecoinTotal(balancesResult.tokens);
        setBalance(newBalance);
        await StorageService.setItem(
          AUTH_STORAGE_KEYS.CACHED_BALANCE,
          newBalance.toString()
        );

        // Activity: map backend rows to legacy shape so the Activity
        // screen continues to render without modification.
        const mapped = transfersResult.transfers.map(mapTransferRowToLegacy);
        setTransfers(mapped as TransferResponse);
      } else {
        // Legacy Grid path (unchanged from pre-Phase-4).
        const easClient = new EasClient();
        const [balanceResult, transfersResult] = await Promise.all([
          easClient
            .getBalance({ smartAccountAddress: user!.address })
            .then((response) => response),
          easClient.getTransfers(user!.address),
        ]);

        const balances = balanceResult.data.tokens;
        if (balances.length === 0) {
          setBalance(0);
          await StorageService.setItem(AUTH_STORAGE_KEYS.CACHED_BALANCE, "0");
        } else {
          const usdcAddress = process.env.EXPO_PUBLIC_USDC_MINT_ADDRESS;
          const usdcBalance = balances.find(
            (balance: any) => balance.token_address === usdcAddress
          );
          if (usdcBalance) {
            const newBalance = parseFloat(
              parseFloat(usdcBalance.amount_decimal).toFixed(2)
            );
            setBalance(newBalance);
            await StorageService.setItem(
              AUTH_STORAGE_KEYS.CACHED_BALANCE,
              newBalance.toString()
            );
          }
        }

        if (transfersResult.data) {
          setTransfers(transfersResult.data);
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch wallet data"
      );
      console.error("Error fetching wallet data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [newStack, user, wallet]);

  // Load cached balance on mount
  useEffect(() => {
    const loadCachedBalance = async () => {
      const cachedBalance = (await StorageService.getItem(
        AUTH_STORAGE_KEYS.CACHED_BALANCE
      )) as string;
      if (cachedBalance) {
        setBalance(parseFloat(cachedBalance));
      }
    };
    loadCachedBalance();
  }, []);

  return {
    balance,
    transfers,
    isLoading,
    error,
    fetchWalletData,
  };
}
