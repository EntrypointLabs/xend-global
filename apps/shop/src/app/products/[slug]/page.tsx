import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ViewTransition } from "react";
import {
  formatUsd,
  ONE_SIGNATURE_LIMIT_CENTS,
  productBySlug,
  skuFor,
} from "@/lib/catalog";
import { displayStock } from "@/lib/orders";
import { ProductArt } from "@/components/ProductArt";
import { AddToBag } from "./AddToBag";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = productBySlug((await params).slug);
  return product
    ? {
        title: `${product.code} ${product.name}`,
        description: product.description,
      }
    : {};
}

export default async function ProductPage({ params }: Props) {
  const product = productBySlug((await params).slug);
  if (!product) notFound();
  const levels = await displayStock();
  const stock = product.sizes
    ? Object.fromEntries(
        product.sizes.map((s) => [s, levels[skuFor(product.id, s)] ?? 0]),
      )
    : { "": levels[skuFor(product.id, null)] ?? 0 };
  const dark = product.priceCents >= ONE_SIGNATURE_LIMIT_CENTS;
  const mute = dark ? "text-night-mute" : "text-mute";
  const rule = dark ? "border-night-line" : "border-line";

  return (
    <div className={`min-h-dvh ${dark ? "bg-night text-night-text" : ""}`}>
      <div className="mx-auto grid max-w-[1400px] gap-8 px-4 pb-24 pt-16 sm:px-6 md:grid-cols-[1fr_380px] md:gap-12 lg:grid-cols-[1fr_420px]">
        <div className="md:sticky md:top-14 md:flex md:h-[calc(100dvh-3.5rem)] md:items-center">
          <ViewTransition
            name={`product-${product.slug}`}
            share="product-morph"
            default="none"
          >
            <ProductArt
              kind={product.art}
              tone={product.tone}
              dark={dark}
              id={`pdp-${product.id}`}
              label={`${product.name}, ${product.line}`}
              className="mx-auto aspect-[4/5] w-full max-w-[640px]"
            />
          </ViewTransition>
        </div>

        <div className="md:pt-24">
          <div className="label flex items-baseline justify-between gap-4">
            <h1>
              {product.code} {product.name}
            </h1>
            <p className="tnum shrink-0">{formatUsd(product.priceCents)}</p>
          </div>
          <p className={`label mt-1 ${mute}`}>
            {product.line}
            {product.limited ? ` · ${product.limited}` : ""}
          </p>

          <AddToBag
            productId={product.id}
            sizes={product.sizes}
            stock={stock}
            dark={dark}
          />

          <p className={`label mt-4 ${mute}`}>
            {dark
              ? "Over $100: approved on your phone"
              : "Under $100: one Face ID"}
          </p>

          <section className={`mt-10 border-t pt-5 ${rule}`}>
            <h2 className="label">Description</h2>
            <p
              className={`mt-3 text-[14px] leading-relaxed ${dark ? "text-night-text/80" : "text-ink/75"}`}
            >
              {product.description}
            </p>
          </section>

          <section className="mt-8">
            <h2 className="label">Details</h2>
            <ul
              className={`mt-3 space-y-1.5 text-[14px] ${dark ? "text-night-text/80" : "text-ink/75"}`}
            >
              {product.details.map((d) => (
                <li key={d} className="flex gap-2.5">
                  <span
                    className={`mt-[9px] h-[3px] w-[3px] shrink-0 ${dark ? "bg-night-mute" : "bg-mute"}`}
                  />
                  {d}
                </li>
              ))}
              <li className="flex gap-2.5">
                <span
                  className={`mt-[9px] h-[3px] w-[3px] shrink-0 ${dark ? "bg-night-mute" : "bg-mute"}`}
                />
                Free shipping, worldwide
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
