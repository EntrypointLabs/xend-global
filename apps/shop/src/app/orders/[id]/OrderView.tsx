"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { checkOrder } from "@/app/actions";
import { rememberOrder, useBag } from "@/components/CartProvider";
import { ProductArt } from "@/components/ProductArt";
import { Symbol } from "@/components/Logo";
import {
  formatUsd,
  ONE_SIGNATURE_LIMIT_CENTS,
  productById,
} from "@/lib/catalog";
import type { Order } from "@/lib/orders";

const POLL_MS = 2500;
const POLL_FOR_MS = 20 * 60_000;

const COPY: Record<
  Order["status"],
  { eyebrow: string; title: string; body: string }
> = {
  awaiting_payment: {
    eyebrow: "CONFIRMING",
    title: "Checking with Prydd.",
    body: "We confirm every payment with Prydd directly before we pack anything. This usually takes a few seconds.",
  },
  paid: {
    eyebrow: "PAID",
    title: "It's yours.",
    body: "Prydd confirmed the payment on Solana and your items are set aside. We'll send shipping updates to",
  },
  needs_review: {
    eyebrow: "PAID · IN REVIEW",
    title: "Paid. We're checking one thing.",
    body: "Your payment went through, but something about the order needs a person to look at it before it ships. We'll be in touch at",
  },
  failed: {
    eyebrow: "NOT PAID",
    title: "The payment didn't go through.",
    body: "Nothing was charged. Your bag is still saved if you want to try again.",
  },
  expired: {
    eyebrow: "EXPIRED",
    title: "This payment timed out.",
    body: "Nothing was charged. Start again from your bag whenever you're ready.",
  },
  canceled: {
    eyebrow: "CANCELED",
    title: "Payment canceled.",
    body: "Nothing was charged. Your bag is still saved.",
  },
};

export function OrderView({
  initial,
  fromCheckout,
}: {
  initial: Order;
  fromCheckout: boolean;
}) {
  const [order, setOrder] = useState(initial);
  const { clear, count } = useBag();

  useEffect(() => {
    rememberOrder(initial.id);
  }, [initial.id]);

  useEffect(() => {
    if (
      fromCheckout &&
      count > 0 &&
      (order.status === "paid" || order.status === "needs_review")
    )
      clear();
  }, [fromCheckout, order.status, count, clear]);

  useEffect(() => {
    if (order.status !== "awaiting_payment") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    const tick = async () => {
      const next = await checkOrder(order.id).catch(() => null);
      if (stopped) return;
      if (next) setOrder(next);
      if (
        (!next || next.status === "awaiting_payment") &&
        Date.now() - started < POLL_FOR_MS
      ) {
        timer = setTimeout(tick, POLL_MS);
      }
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [order.id, order.status]);

  const copy = COPY[order.status];
  const pending = order.status === "awaiting_payment";
  const good = order.status === "paid" || order.status === "needs_review";
  const overLimit = order.totalCents >= ONE_SIGNATURE_LIMIT_CENTS;

  return (
    <div className="mx-auto max-w-[760px] px-5 pt-12 sm:px-8 md:pt-16">
      <div className="flex items-center gap-4">
        <span
          className={`flex h-12 w-12 items-center justify-center rounded-full transition-colors duration-500 ${
            good
              ? "bg-ink text-canvas"
              : pending
                ? "bg-canvas-2 text-ink"
                : "bg-canvas-2 text-mute"
          }`}
        >
          {good ? (
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          ) : (
            <Symbol className={`h-5 w-auto ${pending ? "pulse-dot" : ""}`} />
          )}
        </span>
        <p className="text-[14px] text-mute">
          Order <span className="font-mono text-ink">{order.number}</span>
        </p>
      </div>

      <h1
        className="rise mt-7 text-[clamp(2.2rem,5vw,3.6rem)] font-medium leading-[1] tracking-[-0.035em]"
        key={order.status}
      >
        {copy.title}
      </h1>
      <p className="mt-5 max-w-[36rem] text-[16px] leading-relaxed text-ink/70">
        {copy.body}
        {good && (
          <>
            {" "}
            <span className="font-medium text-ink">{order.email}</span>.
          </>
        )}
      </p>

      {pending && overLimit && (
        <div className="mt-7 flex gap-4 rounded-xl bg-ink p-5 text-canvas">
          <svg
            viewBox="0 0 24 24"
            className="mt-0.5 h-5 w-5 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
            <path d="M11 18.5h2" strokeLinecap="round" />
          </svg>
          <p className="text-[14px] leading-relaxed text-canvas/80">
            <span className="font-medium text-canvas">
              Approve it on your phone.
            </span>{" "}
            This order is over $100, so the Prydd app asks you to confirm it.
            Keep this page open and it updates the moment you do.
          </p>
        </div>
      )}

      <div className="mt-12 rounded-2xl bg-white p-6 border border-line sm:p-8">
        <div className="flex items-baseline justify-between border-b border-line pb-4">
          <p className="text-[15px] font-medium">Order {order.number}</p>
          <p className="text-[13px] text-mute">
            {new Date(order.createdAt).toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        </div>
        <ul className="divide-y divide-line">
          {order.items.map((i) => {
            const product = productById(i.productId);
            return (
              <li
                key={`${i.productId}-${i.size}`}
                className="flex items-center gap-4 py-4"
              >
                <div className="w-14 shrink-0 overflow-hidden rounded-xl bg-canvas-2">
                  {product && (
                    <ProductArt
                      kind={product.art}
                      tone={product.tone}
                      id={`ord-${i.productId}-${i.size}`}
                      label={i.name}
                      className="aspect-[4/5] w-full"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">{i.name}</p>
                  <p className="text-[13px] text-mute">
                    {i.line}
                    {i.size ? ` · ${i.size}` : ""} · Qty {i.qty}
                  </p>
                </div>
                <p className="tnum font-medium text-[14px]">
                  {formatUsd(i.unitCents * i.qty)}
                </p>
              </li>
            );
          })}
        </ul>
        <div className="flex items-baseline justify-between border-t border-line pt-4">
          <p className="text-[15px] font-medium">Total</p>
          <p className="tnum font-medium text-[22px]">
            {formatUsd(order.totalCents)}
          </p>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-4 rounded-2xl bg-canvas/60 p-4 text-[13px]">
          <div>
            <dt className="text-mute">Paid with</dt>
            <dd className="mt-0.5 flex items-center gap-1.5 font-medium">
              <Symbol className="h-3 w-auto" /> Prydd, USDC
            </dd>
          </div>
          <div>
            <dt className="text-mute">Status</dt>
            <dd className="mt-0.5 flex items-center gap-2 font-medium">
              <span
                className={`h-1.5 w-1.5 rounded-full ${good ? "bg-ok" : pending ? "pulse-dot bg-ink" : "bg-mute"}`}
              />
              {good
                ? order.paidAt
                  ? `Paid ${new Date(order.paidAt).toLocaleTimeString("en-US", { timeStyle: "short" })}`
                  : "Paid"
                : pending
                  ? "Waiting for payment"
                  : copy.eyebrow.charAt(0) +
                    copy.eyebrow.slice(1).toLowerCase()}
            </dd>
          </div>
          {order.intentId && (
            <div className="col-span-2">
              <dt className="text-mute">Payment reference</dt>
              <dd className="mt-0.5 truncate font-mono text-[12px]">
                {order.intentId}
              </dd>
            </div>
          )}
        </dl>
      </div>

      <div className="mt-8 flex flex-wrap gap-3 text-[14px] font-medium">
        {good ? (
          <Link href="/" className="rounded-full bg-ink px-5 py-3 text-canvas">
            Keep shopping
          </Link>
        ) : pending ? null : (
          <Link
            href="/checkout"
            className="rounded-full bg-ink px-5 py-3 text-canvas"
          >
            Back to bag
          </Link>
        )}
        <Link
          href="/orders"
          className="rounded-full border border-ink/15 px-5 py-3 hover:bg-canvas-2"
        >
          All your orders
        </Link>
      </div>
    </div>
  );
}
