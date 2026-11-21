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
  const statusLabel = good
    ? order.paidAt
      ? `Paid ${new Date(order.paidAt).toLocaleTimeString("en-US", { timeStyle: "short" })}`
      : "Paid"
    : pending
      ? "Waiting for payment"
      : copy.eyebrow.charAt(0) + copy.eyebrow.slice(1).toLowerCase();

  return (
    <div className="mx-auto max-w-[560px] px-4 pb-24 pt-24 sm:pt-28">
      <div className="flex flex-col items-center text-center">
        <span
          className={`flex h-10 w-10 items-center justify-center transition-colors duration-500 ${
            good ? "bg-ink text-white" : "border border-line text-ink"
          }`}
        >
          {good ? (
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="square"
            >
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          ) : (
            <Symbol className={`h-4 w-auto ${pending ? "pulse-dot" : ""}`} />
          )}
        </span>
        <p className="label mt-5 text-mute">Order {order.number}</p>
        <h1
          key={order.status}
          className="settle mt-3 text-[clamp(1.9rem,4.4vw,2.8rem)] font-medium leading-[1.05] tracking-[-0.03em]"
        >
          {copy.title}
        </h1>
        <p className="mt-4 max-w-[30rem] text-[15px] leading-relaxed text-ink/70">
          {copy.body}
          {good && (
            <>
              {" "}
              <span className="text-ink">{order.email}</span>.
            </>
          )}
        </p>
      </div>

      {pending && overLimit && (
        <div className="mt-8 bg-night p-5 text-night-text">
          <p className="label">Approve it on your phone</p>
          <p className="mt-2 text-[14px] leading-relaxed text-night-mute">
            This order is over $100, so the Prydd app asks you to confirm it.
            Keep this page open and it updates the moment you do.
          </p>
        </div>
      )}

      <div className="mt-12 border-t border-ink">
        <ul>
          {order.items.map((i) => {
            const product = productById(i.productId);
            return (
              <li
                key={`${i.productId}-${i.size}`}
                className="label flex items-center gap-4 border-b border-line py-3"
              >
                <div className="w-12 shrink-0">
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
                  <p className="truncate">
                    {product?.code} {i.name}
                  </p>
                  <p className="text-mute">
                    {i.line}
                    {i.size ? ` · ${i.size}` : ""} · Qty {i.qty}
                  </p>
                </div>
                <p className="tnum">{formatUsd(i.unitCents * i.qty)}</p>
              </li>
            );
          })}
        </ul>
        <dl className="label mt-4 space-y-2">
          <div className="flex justify-between">
            <dt>Total</dt>
            <dd className="tnum">{formatUsd(order.totalCents)}</dd>
          </div>
          <div className="flex justify-between text-mute">
            <dt>Paid with</dt>
            <dd className="flex items-center gap-1.5">
              <Symbol className="h-3 w-auto" /> Prydd, USDC
            </dd>
          </div>
          <div className="flex justify-between text-mute">
            <dt>Status</dt>
            <dd className="flex items-center gap-2">
              <span
                className={`h-1.5 w-1.5 ${good ? "bg-ok" : pending ? "pulse-dot bg-ink" : "bg-mute"}`}
              />
              {statusLabel}
            </dd>
          </div>
          <div className="flex justify-between text-mute">
            <dt>Placed</dt>
            <dd>
              {new Date(order.createdAt).toLocaleString("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </dd>
          </div>
          {order.intentId && (
            <div className="flex justify-between gap-6 text-mute">
              <dt className="shrink-0">Reference</dt>
              <dd className="truncate normal-case">{order.intentId}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="label mt-10 flex flex-col gap-1.5 sm:flex-row">
        {good ? (
          <Link
            href="/"
            className="flex h-12 flex-1 items-center justify-center bg-ink text-white"
          >
            Continue shopping
          </Link>
        ) : pending ? null : (
          <Link
            href="/checkout"
            className="flex h-12 flex-1 items-center justify-center bg-ink text-white"
          >
            Back to bag
          </Link>
        )}
        <Link
          href="/orders"
          className="flex h-12 flex-1 items-center justify-center border border-line hover:border-ink"
        >
          All your orders
        </Link>
      </div>
    </div>
  );
}
