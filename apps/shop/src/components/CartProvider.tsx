"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface BagLine {
  productId: string;
  size: string | null;
  qty: number;
}

interface BagState {
  lines: BagLine[];
  ready: boolean;
  count: number;
  add: (line: BagLine) => void;
  setQty: (productId: string, size: string | null, qty: number) => void;
  clear: () => void;
}

const BagContext = createContext<BagState | null>(null);

export function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or full storage: the bag still works for this page view.
  }
}
const KEY = "prydd-shop-bag";

function read(): BagLine[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<BagLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLines(read());
    setReady(true);
    const onStorage = (e: StorageEvent) => e.key === KEY && setLines(read());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const commit = useCallback((next: BagLine[]) => {
    setLines(next);
    writeStorage(KEY, next);
  }, []);

  const value = useMemo<BagState>(
    () => ({
      lines,
      ready,
      count: lines.reduce((n, l) => n + l.qty, 0),
      add: (line) => {
        const i = lines.findIndex(
          (l) => l.productId === line.productId && l.size === line.size,
        );
        if (i === -1) commit([...lines, line]);
        else
          commit(
            lines.map((l, j) =>
              j === i ? { ...l, qty: Math.min(5, l.qty + line.qty) } : l,
            ),
          );
      },
      setQty: (productId, size, qty) =>
        commit(
          qty <= 0
            ? lines.filter(
                (l) => !(l.productId === productId && l.size === size),
              )
            : lines.map((l) =>
                l.productId === productId && l.size === size
                  ? { ...l, qty: Math.min(5, qty) }
                  : l,
              ),
        ),
      clear: () => commit([]),
    }),
    [lines, ready, commit],
  );

  return <BagContext.Provider value={value}>{children}</BagContext.Provider>;
}

export function useBag(): BagState {
  const ctx = useContext(BagContext);
  if (!ctx) throw new Error("useBag outside CartProvider");
  return ctx;
}

const ORDERS_KEY = "prydd-shop-orders";

export function rememberOrder(id: string) {
  const prev = rememberedOrders();
  writeStorage(ORDERS_KEY, [id, ...prev.filter((p) => p !== id)].slice(0, 20));
}

export function rememberedOrders(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ORDERS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
