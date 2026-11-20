"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { lookupOrders, recentOrders } from "@/app/actions";
import { rememberedOrders } from "@/components/CartProvider";
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
        className="flex items-center justify-between gap-4 py-4 transition-colors hover:bg-canvas-2/60 sm:px-2"
      >
        <div className="min-w-0">
          <p className="font-mono text-[13px]">{order.number}</p>
          <p className="truncate text-[13px] text-mute">
            {count} {count === 1 ? "item" : "items"} ·{" "}
            {new Date(order.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <span className="flex items-center gap-2 text-[13px]">
            <span
              className={`h-1.5 w-1.5 rounded-full ${good ? "bg-ok" : order.status === "awaiting_payment" ? "bg-ink" : "bg-mute/50"}`}
            />
            {LABEL[order.status]}
          </span>
          <span className="tnum w-16 text-right font-medium text-[14px]">
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

  const visibleMine =
    mine?.filter((o) => o.status !== "failed" || o.intentId) ?? [];

  return (
    <div className="mx-auto max-w-[760px] px-5 pt-12 sm:px-8 md:pt-16">
      <h1 className="text-[clamp(2rem,4.4vw,3rem)] font-medium tracking-[-0.03em]">
        Find an order.
      </h1>

      <form
        className="mt-8 grid gap-2.5 sm:grid-cols-[1.4fr_1fr_auto]"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setFound(await lookupOrders(email, number).catch(() => []));
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
          className="h-12 rounded-xl border border-line bg-white px-4 text-[15px] outline-none placeholder:text-ink/55 focus:border-ink"
        />
        <input
          placeholder="Order number, optional"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          className="h-12 rounded-xl border border-line bg-white px-4 font-mono text-[14px] uppercase outline-none placeholder:font-sans placeholder:normal-case placeholder:text-ink/55 focus:border-ink"
        />
        <button
          disabled={busy}
          className="h-12 rounded-xl bg-ink px-6 text-[14px] font-medium text-canvas disabled:opacity-50"
        >
          {busy ? "Looking" : "Look up"}
        </button>
      </form>

      {found && (
        <section className="mt-10">
          <h2 className="border-b border-line pb-3 text-[15px] font-medium">
            {found.length === 0
              ? "No orders found for that email."
              : `${found.length} ${found.length === 1 ? "order" : "orders"}`}
          </h2>
          <ul className="divide-y divide-line">
            {found.map((o) => (
              <OrderRow key={o.id} order={o} />
            ))}
          </ul>
        </section>
      )}

      <section className="mt-14">
        <h2 className="border-b border-line pb-3 text-[15px] font-medium">
          On this device
        </h2>
        {mine === null ? (
          <p className="py-4 text-[14px] text-mute">Loading</p>
        ) : visibleMine.length === 0 ? (
          <p className="py-4 text-[14px] text-mute">
            Orders you place in this browser show up here.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {visibleMine.map((o) => (
              <OrderRow key={o.id} order={o} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
