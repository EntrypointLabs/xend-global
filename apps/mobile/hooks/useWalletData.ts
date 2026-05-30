import { useState, useEffect, useCallback } from "react";
import { TransferResponse } from "@/types/Transaction";
import { StorageService } from "@/utils/storage";
import { AUTH_STORAGE_KEYS } from "@/utils/auth";
import { AccountInfo } from "@/types/Auth";
import { useAuth } from "@/contexts/AuthContext";
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
    const raw = BigInt(t.amountRaw);
    const divisor = BigInt(10) ** BigInt(t.decimals);
    const whole = Number(raw / divisor);
    const fractionRaw = Number(raw % divisor);
    const fraction = fractionRaw / Number(divisor);
    total += whole + fraction;
  }
  return parseFloat(total.toFixed(2));
}

/**
 * Map a backend `TransferRow` (new-stack shape) to the legacy mobile
 * `TransferResponse` shape that `(tabs)/index.tsx` reads. The Activity
 * feed reads snake_case fields inherited from the Grid BFF passthrough;
 * this mapping reproduces that shape so the screen stays untouched.
 *
 * Direction translation: SEND → "outflow", RECEIVE → "inflow".
 * Status translation: CONFIRMED → "confirmed", FAILED → "failed", else
 * "pending".
 */
function mapTransferRowToLegacy(row: TransferRow): any {
  const confirmation_status =
    row.status === "CONFIRMED"
      ? "confirmed"
      : row.status === "FAILED"
        ? "failed"
        : "pending";
  const direction = row.direction === "SEND" ? "outflow" : "inflow";
  const raw = BigInt(row.amountRaw);
  // Default decimals to 6 (USDC, USDT). The backend TransferRow schema
  // does not carry per-row decimals; the Activity feed today filters to
  // USDC-mint rows only.
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

export function useWalletData(_accountInfo: AccountInfo | null) {
  const [isLoading, setIsLoading] = useState(false);
  const [balance, setBalance] = useState(0);
  const [transfers, setTransfers] = useState<TransferResponse>([]);
  const [error, setError] = useState<string | null>(null);
  const { user, wallet } = useAuth();

  const fetchWalletData = useCallback(async () => {
    // JWT is the auth signal; `wallet` (from AuthContext) is the Privy
    // embedded wallet address. Either signal indicates the user is past
    // login and ready to fetch.
    const hasIdentity =
      Boolean(wallet) || Boolean(user?.walletAddress) || Boolean(user?.address);
    if (!hasIdentity) {
      setError("Account info not found");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [balancesResult, transfersResult] = await Promise.all([
        apiClient.getBalances(),
        apiClient.listTransfers({ limit: 50 }),
      ]);

      const newBalance = computeStablecoinTotal(balancesResult.tokens);
      setBalance(newBalance);
      await StorageService.setItem(
        AUTH_STORAGE_KEYS.CACHED_BALANCE,
        newBalance.toString()
      );

      const mapped = transfersResult.transfers.map(mapTransferRowToLegacy);
      setTransfers(mapped as TransferResponse);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch wallet data"
      );
      console.error("Error fetching wallet data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [user, wallet]);

  // Load cached balance on mount.
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
