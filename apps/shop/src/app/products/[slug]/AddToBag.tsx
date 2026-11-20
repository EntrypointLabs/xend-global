"use client";

import Link from "next/link";
import { useState } from "react";
import { useBag } from "@/components/CartProvider";

export function AddToBag({
  productId,
  sizes,
  stock,
}: {
  productId: string;
  sizes: string[] | null;
  stock: Record<string, number>;
}) {
  const { add } = useBag();
  const firstInStock = sizes?.find((s) => (stock[s] ?? 0) > 0) ?? null;
  const [size, setSize] = useState<string | null>(firstInStock);
  const [added, setAdded] = useState(false);
  const available = sizes ? (size ? (stock[size] ?? 0) : 0) : (stock[""] ?? 0);
  const soldOut = sizes ? !firstInStock : available === 0;

  return (
    <div className="mt-8">
      {sizes && (
        <fieldset>
          <legend className="mb-3 flex w-full justify-between text-[13px]">
            <span className="font-medium">Size</span>
            {size && available > 0 && available <= 5 && (
              <span className="text-mute">
                Only {available} left in {size}
              </span>
            )}
          </legend>
          <div className="grid grid-cols-4 gap-2">
            {sizes.map((s) => {
              const out = (stock[s] ?? 0) === 0;
              const on = s === size;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={out}
                  onClick={() => {
                    setSize(s);
                    setAdded(false);
                  }}
                  aria-pressed={on}
                  className={`h-12 rounded-xl border text-[14px] font-medium transition-colors ${
                    on
                      ? "border-ink bg-ink text-canvas"
                      : "border-line hover:border-ink/40"
                  } disabled:cursor-not-allowed disabled:border-dashed disabled:text-ink/30 disabled:line-through`}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <div className="mt-5 flex gap-3">
        <button
          type="button"
          disabled={soldOut || (sizes !== null && !size)}
          onClick={() => {
            add({ productId, size: sizes ? size : null, qty: 1 });
            setAdded(true);
          }}
          className="h-14 flex-1 rounded-full bg-ink text-[15px] font-medium text-canvas transition-transform active:scale-[0.98] disabled:bg-ink/25"
        >
          {soldOut ? "Sold out" : added ? "Added. Add another" : "Add to bag"}
        </button>
        {added && (
          <Link
            href="/checkout"
            className="flex h-14 items-center rounded-full border border-ink/15 px-6 text-[15px] font-medium transition-colors hover:bg-canvas-2"
          >
            Check out
          </Link>
        )}
      </div>
      {!sizes && available > 0 && available <= 5 && (
        <p className="mt-3 text-[13px] text-mute">Only {available} left.</p>
      )}
    </div>
  );
}
