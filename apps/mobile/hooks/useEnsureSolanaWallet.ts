import { useRef } from "react";
import { useEmbeddedSolanaWallet } from "@privy-io/expo";

const WALLET_POLL_INTERVAL_MS = 150;
const WALLET_READY_TIMEOUT_MS = 8000;

/**
 * Privy provisions the embedded Solana wallet asynchronously after login
 * (config `embedded.solana.createOnLogin: "users-without-wallets"`), so a
 * brand-new consumer can reach `/auth/exchange` before the wallet exists on
 * Privy's servers. The backend then verifies an identity with no linked Solana
 * wallet and rejects the exchange (422). This hook returns an awaitable that
 * resolves with the embedded wallet address once it is present, nudging
 * creation once if Privy never started it.
 *
 * The poll reads a ref rather than the closed-over hook state so the reactive
 * wallet update (status: creating -> connected) is observed inside the loop.
 */
export function useEnsureSolanaWallet() {
  const solana = useEmbeddedSolanaWallet();
  const ref = useRef(solana);
  ref.current = solana;

  return async function ensureSolanaWalletReady(): Promise<string> {
    const currentAddress = () => ref.current.wallets?.[0]?.address ?? null;

    const existing = currentAddress();
    if (existing) return existing;

    // createOnLogin auto-provisions for users without a wallet, but if that
    // never kicked in, start it once. Any "already creating/created" error is
    // the auto-provision race; the poll below picks up the resulting wallet.
    if (ref.current.status === "not-created" && ref.current.create) {
      try {
        await ref.current.create();
      } catch {
        // fall through to the poll
      }
    }

    const maxIterations = Math.ceil(
      WALLET_READY_TIMEOUT_MS / WALLET_POLL_INTERVAL_MS
    );
    for (let i = 0; i < maxIterations; i++) {
      const address = currentAddress();
      if (address) return address;
      await new Promise((resolve) =>
        setTimeout(resolve, WALLET_POLL_INTERVAL_MS)
      );
    }

    throw new Error("Embedded Solana wallet was not ready after login");
  };
}
