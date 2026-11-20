import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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
        title: `${product.name}, ${product.line}`,
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
  const overLimit = product.priceCents >= ONE_SIGNATURE_LIMIT_CENTS;

  return (
    <div className="mx-auto grid max-w-[1320px] gap-10 px-5 pt-8 sm:px-8 md:grid-cols-[1.2fr_1fr] md:gap-16 md:pt-12">
      <div className="rise overflow-hidden rounded-2xl bg-canvas-2 md:sticky md:top-24 md:self-start">
        <ProductArt
          kind={product.art}
          tone={product.tone}
          id={`pdp-${product.id}`}
          label={`${product.name}, ${product.line}`}
          className="aspect-[4/5] w-full"
        />
      </div>

      <div className="rise md:pt-6" style={{ animationDelay: "80ms" }}>
        <Link href="/" className="text-[13px] text-mute hover:text-ink">
          ← Issue 01, No. {product.number}
        </Link>
        <h1 className="mt-6 text-[clamp(2rem,3.6vw,3rem)] font-medium leading-[1.02] tracking-[-0.03em]">
          {product.name}
        </h1>
        <p className="mt-2 text-[16px] text-mute">{product.line}</p>
        <p className="tnum mt-6 font-medium text-[22px]">
          {formatUsd(product.priceCents)}
        </p>
        {product.limited && (
          <p className="mt-3 inline-block rounded-full border border-ink/15 px-3 py-1 text-[12px] font-medium">
            {product.limited}
          </p>
        )}

        <p className="mt-8 max-w-[34rem] text-[15px] leading-relaxed text-ink/75">
          {product.description}
        </p>

        <AddToBag productId={product.id} sizes={product.sizes} stock={stock} />

        <div className="mt-8 flex gap-4 rounded-xl bg-canvas-2 p-5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-canvas">
            {overLimit ? (
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
                <path d="M11 18.5h2" strokeLinecap="round" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M9 9.5v1M15 9.5v1M12 9.5v3.5h-1M9.5 15.5c1.4 1 3.6 1 5 0" />
              </svg>
            )}
          </span>
          <div className="text-[14px] leading-relaxed">
            <p className="font-medium">
              {overLimit ? "Approved on your phone" : "One Face ID at checkout"}
            </p>
            <p className="text-mute">
              {overLimit
                ? "This is over the $100 one-signature limit, so the Prydd app asks you to approve it before it pays."
                : "Under the $100 one-signature limit. Your passkey confirms it and you are done."}
            </p>
          </div>
        </div>

        <ul className="mt-8 divide-y divide-line border-y border-line text-[14px]">
          {product.details.map((d) => (
            <li key={d} className="py-3.5">
              {d}
            </li>
          ))}
          <li className="flex justify-between py-3.5 text-mute">
            <span>Shipping</span>
            <span>Free, worldwide</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
