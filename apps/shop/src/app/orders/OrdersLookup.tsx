"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { lookupOrders, recentOrders } from "@/app/actions";
import { rememberedOrders } from "@/components/CartProvider";
import { analytics } from "@/lib/analytics";
import { formatUsd } from "@/lib/catalog";
import type { Order } from "@/lib/orders";

const LABEL: Record<Order["status"], string> = {
  awaiting_payment: "Waiting for payment",
  paid: "Paid",
  needs_review: "Paid, in review",
  failed: "Not paid",
  expired: "Expired",
  canceled: "Canceled",
};

function OrderRow({ order }: { order: Order }) {
  const good = order.status === "paid" || order.status === "needs_review";
  const count = order.items.reduce((n, i) => n + i.qty, 0);
  return (
    <li>
      <Link
        href={`/orders/${order.id}`}
        className="label flex items-center justify-between gap-4 border-b border-line py-3.5 hover:bg-canvas-2"
      >
        <div className="min-w-0">
          <p>{order.number}</p>
          <p className="truncate text-mute">
            {count} {count === 1 ? "item" : "items"} ·{" "}
            {new Date(order.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-5">
          <span className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 ${good ? "bg-ok" : order.status === "awaiting_payment" ? "bg-ink" : "bg-mute/50"}`}
            />
            {LABEL[order.status]}
          </span>
          <span className="tnum w-14 text-right">
            {formatUsd(order.totalCents)}
          </span>
        </div>
      </Link>
    </li>
  );
}

export function OrdersLookup() {
  const [mine, setMine] = useState<Order[] | null>(null);
  const [email, setEmail] = useState("");
  const [number, setNumber] = useState("");
  const [found, setFound] = useState<Order[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    recentOrders(rememberedOrders())
      .then(setMine)
      .catch(() => setMine([]));
  }, []);

  const visibleMine = mine ?? [];
  const input =
    "h-12 w-full border border-line bg-white px-3.5 text-[14px] outline-none placeholder:font-mono placeholder:text-[12px] placeholder:uppercase placeholder:tracking-[0.04em] placeholder:text-mute focus:border-ink";

  return (
    <div className="mx-auto max-w-[620px] px-4 pb-24 pt-24 sm:pt-28">
      <h1 className="label text-center">Find an order</h1>

      <form
        className="mt-8 grid gap-1.5 sm:grid-cols-[1.4fr_1fr_auto]"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const result = await lookupOrders(email, number).catch(() => []);
          analytics.track("shop_order_lookup", { found: result.length > 0 });
          setFound(result);
          setBusy(false);
        }}
      >
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="Email used at checkout"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={input}
        />
        <input
          placeholder="Order number"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          className={`${input} font-mono uppercase`}
        />
        <button
          disabled={busy}
          className="label h-12 bg-ink px-6 text-white disabled:opacity-50"
        >
          {busy ? "Looking" : "Look up"}
        </button>
      </form>

      {found && (
        <section className="mt-12">
          <h2 className="label border-b border-ink pb-3">
            {found.length === 0
              ? "No orders for that email"
              : `${found.length} ${found.length === 1 ? "order" : "orders"}`}
          </h2>
          <ul>
            {found.map((o) => (
              <OrderRow key={o.id} order={o} />
            ))}
          </ul>
        </section>
      )}

      <section className="mt-12">
        <h2 className="label border-b border-ink pb-3">On this device</h2>
        {mine === null ? (
          <p className="label py-4 text-mute">Loading</p>
        ) : visibleMine.length === 0 ? (
          <p className="label py-4 text-mute">
            Orders you place in this browser show up here
          </p>
        ) : (
          <ul>
            {visibleMine.map((o) => (
              <OrderRow key={o.id} order={o} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
