import Link from "next/link";
import { formatUsd, type Product } from "@/lib/catalog";
import { ProductArt } from "./ProductArt";

export function ProductCard({
  product,
  stock,
  dark,
  index,
}: {
  product: Product;
  stock: number;
  dark?: boolean;
  index: number;
}) {
  const soldOut = stock === 0;
  const low = !soldOut && stock <= 5;
  return (
    <Link
      href={`/products/${product.slug}`}
      className="group rise block"
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
    >
      <div
        className={`relative overflow-hidden rounded-[14px] ${dark ? "bg-ink-2" : "bg-canvas-2"}`}
      >
        <ProductArt
          kind={product.art}
          tone={product.tone}
          id={`card-${product.id}`}
          label={`${product.name}, ${product.line}`}
          className={`aspect-[4/5] w-full transition-transform duration-700 ease-out-quint group-hover:scale-[1.03] ${soldOut ? "opacity-45 grayscale" : ""}`}
        />
        <span
          className={`absolute left-4 top-4 font-mono text-[11px] tracking-[0.14em] ${dark ? "text-canvas/45" : "text-ink/40"}`}
        >
          NO. {product.number}
        </span>
        {(soldOut || low || product.limited) && (
          <span
            className={`absolute right-4 top-4 rounded-full px-2.5 py-1 text-[11px] font-medium ${
              soldOut
                ? "bg-ink text-canvas"
                : dark
                  ? "bg-canvas/10 text-canvas/80"
                  : "bg-canvas/80 text-ink/80"
            }`}
          >
            {soldOut ? "Sold out" : low ? `${stock} left` : product.limited}
          </span>
        )}
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-4 px-1">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-medium">{product.name}</h3>
          <p
            className={`truncate text-[13px] ${dark ? "text-canvas/50" : "text-mute"}`}
          >
            {product.line}
          </p>
        </div>
        <p className="tnum shrink-0 font-medium text-[14px]">
          {formatUsd(product.priceCents)}
        </p>
      </div>
    </Link>
  );
}
