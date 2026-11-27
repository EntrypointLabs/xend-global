"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useBag } from "@/components/CartProvider";
import { analytics } from "@/lib/analytics";
import { productById } from "@/lib/catalog";

export function AddToBag({
  productId,
  sizes,
  stock,
  dark,
}: {
  productId: string;
  sizes: string[] | null;
  stock: Record<string, number>;
  dark: boolean;
}) {
  const { add } = useBag();
  useEffect(() => {
    const slug = productById(productId)?.slug;
    if (slug) analytics.track("shop_product_viewed", { product: slug });
  }, [productId]);
  const firstInStock = sizes?.find((s) => (stock[s] ?? 0) > 0) ?? null;
  const [size, setSize] = useState<string | null>(firstInStock);
  const [added, setAdded] = useState(false);
  const available = sizes ? (size ? (stock[size] ?? 0) : 0) : (stock[""] ?? 0);
  const soldOut = sizes ? !firstInStock : available === 0;

  const idle = dark
    ? "border-night-line hover:border-night-mute"
    : "border-line hover:border-ink/40";
  const on = dark
    ? "border-night-text bg-night-text text-night"
    : "border-ink bg-ink text-white";
  const primary = dark ? "bg-night-text text-night" : "bg-ink text-white";

  return (
    <div className="mt-10">
      {sizes && (
        <fieldset>
          <legend className="label mb-3 flex w-full justify-between">
            <span>Size</span>
            {size && available > 0 && available <= 5 && (
              <span className={dark ? "text-night-mute" : "text-mute"}>
                {available} left in {size}
              </span>
            )}
          </legend>
          <div className="grid grid-cols-4 gap-1.5">
            {sizes.map((s) => {
              const out = (stock[s] ?? 0) === 0;
              const selected = s === size;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={out}
                  onClick={() => {
                    setSize(s);
                    setAdded(false);
                  }}
                  aria-pressed={selected}
                  className={`label h-11 border transition-colors ${selected ? on : idle} disabled:cursor-not-allowed disabled:opacity-35 disabled:line-through`}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <button
        type="button"
        disabled={soldOut || (sizes !== null && !size)}
        onClick={() => {
          add({ productId, size: sizes ? size : null, qty: 1 });
          setAdded(true);
        }}
        className={`label mt-3 h-12 w-full transition-opacity active:opacity-80 disabled:cursor-not-allowed disabled:opacity-35 ${primary}`}
      >
        {soldOut ? "Sold out" : added ? "Added. Add another" : "Add to bag"}
      </button>
      {added && (
        <Link
          href="/checkout"
          className={`label mt-1.5 flex h-12 w-full items-center justify-center border transition-colors ${idle}`}
        >
          Check out
        </Link>
      )}
      {!sizes && available > 0 && available <= 5 && (
        <p className={`label mt-3 ${dark ? "text-night-mute" : "text-mute"}`}>
          {available} left
        </p>
      )}
    </div>
  );
}
