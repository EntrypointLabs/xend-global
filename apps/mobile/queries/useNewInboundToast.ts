import { useEffect, useRef } from "react";
import { useWalletQuery } from "./useWalletQuery";
import { useTransactionsQuery } from "./useTransactionsQuery";
import { useToast } from "@/contexts/ToastContext";
import { StorageService } from "@/utils/storage";
import { AUTH_STORAGE_KEYS } from "@/utils/auth";

/**
 * Side-effect-only hook that fires an in-app toast whenever the transactions
 * query reveals a new inbound transfer since the last poll. Mounted once near
 * the app root.
 *
 * Cursor lifecycle (the tricky part — see PITFALLS H3):
 *   - cursorRef.current === undefined → cursor not yet loaded from storage; bail.
 *   - cursorRef.current === null      → fresh login with no historical cursor;
 *                                       silently seed to newest inbound sig.
 *                                       Crucial: NO toast on cold launch when
 *                                       a user has older incoming txs already.
 *   - cursorRef.current === string    → diff against this; toast each new sig
 *                                       above it, oldest-first.
 *
 * Self-send filtering is handled by the Phase 4 adapter; transactions reaching
 * this hook already have outflows assigned `type: "sent"`, so the `type ===
 * "received"` filter is sufficient.
 *
 * Cursor is held in useRef (not state) to avoid re-render loops on every poll.
 */
export function useNewInboundToast(): void {
  const { showToast } = useToast();
  const walletQuery = useWalletQuery();
  const myAddress = walletQuery.data?.gridAccountId ?? "";
  const txQuery = useTransactionsQuery({ gridAccountId: myAddress });

  const cursorRef = useRef<string | null | undefined>(undefined);

  // Load the persisted cursor exactly once. After this resolves, the diff
  // effect below can start firing toasts.
  useEffect(() => {
    let cancelled = false;
    StorageService.getItem<string>(AUTH_STORAGE_KEYS.LAST_SEEN_INBOUND_SIG)
      .then((v) => {
        if (cancelled) return;
        cursorRef.current = (v as string) ?? null;
      })
      .catch(() => {
        // SecureStore read failure shouldn't break the screen. Treat as "no cursor".
        if (cancelled) return;
        cursorRef.current = null;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Diff on every refetch. Re-keys on `myAddress` so a re-login under a
  // different wallet doesn't carry the prior user's cursor logic.
  useEffect(() => {
    if (cursorRef.current === undefined) return;
    if (!txQuery.data || !myAddress) return;

    const inbound = txQuery.data.filter(
      (t) => t.type === "received" && t.to === myAddress,
    );
    if (inbound.length === 0) return;

    const newestSig = inbound[0].signature;

    // Bootstrap case: first poll since login. Seed silently — never replay
    // historical inbound as a toast.
    if (cursorRef.current === null) {
      cursorRef.current = newestSig;
      void StorageService.setItem(
        AUTH_STORAGE_KEYS.LAST_SEEN_INBOUND_SIG,
        newestSig,
      );
      return;
    }

    if (newestSig === cursorRef.current) return;

    // Collect everything newer than the cursor (the inbound list is sorted
    // newest-first by the adapter). Reverse to surface oldest-first so the
    // toasts read in chronological order.
    const newOnes: typeof inbound = [];
    for (const t of inbound) {
      if (t.signature === cursorRef.current) break;
      newOnes.push(t);
    }
    for (const t of newOnes.reverse()) {
      showToast(`Received ${t.amount} USDC`);
    }
    cursorRef.current = newestSig;
    void StorageService.setItem(
      AUTH_STORAGE_KEYS.LAST_SEEN_INBOUND_SIG,
      newestSig,
    );
  }, [txQuery.data, myAddress, showToast]);
}
