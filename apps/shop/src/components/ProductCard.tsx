import Link from "next/link";
import { formatUsd, type Product } from "@/lib/catalog";
import { ProductArt } from "./ProductArt";

export function ProductCard({
  product,
  stock,
  dark,
}: {
  product: Product;
  stock: number;
  dark?: boolean;
}) {
  const soldOut = stock === 0;
  const low = !soldOut && stock <= 5;
  const tag = soldOut
    ? "Sold out"
    : low
      ? `${stock} left`
      : (product.limited ?? null);
  return (
    <Link
      href={`/products/${product.slug}`}
      className="group block"
      aria-label={`${product.name}, ${product.line}, ${formatUsd(product.priceCents)}${soldOut ? ", sold out" : ""}`}
    >
      <div className="relative">
        <ProductArt
          kind={product.art}
          tone={product.tone}
          dark={dark}
          id={`card-${product.id}`}
          label={`${product.name}, ${product.line}`}
          className={`aspect-[4/5] w-full transition-transform duration-500 ease-out-quint group-hover:scale-[1.04] ${
            soldOut ? "opacity-40" : ""
          }`}
        />
        {tag && (
          <span
            className={`label absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap px-1.5 py-0.5 ${
              soldOut || !dark
                ? "bg-ink text-white"
                : "bg-night-text text-night"
            } ${soldOut ? "" : "opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"}`}
          >
            {tag}
          </span>
        )}
      </div>
      <div className="label mt-1 text-center">
        <p>{product.code}</p>
        <p className={`tnum mt-1 ${dark ? "text-night-mute" : "text-mute"}`}>
          {formatUsd(product.priceCents)}
        </p>
      </div>
    </Link>
  );
}
