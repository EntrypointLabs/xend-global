"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import {
  CheckoutError,
  ordersByIds,
  ordersFor,
  placeOrder,
  reconcileOpenOrders,
  reconcileOrder,
  refreshOpen,
  displayStock,
  type CartLine,
  type Order,
} from "@/lib/orders";
import { PryddApiError } from "@/lib/prydd";

export type StartCheckoutResult =
  | { ok: true; reference: string; orderId: string }
  | { ok: false; error: string };

async function siteUrl(): Promise<string | null> {
  if (process.env.SHOP_PUBLIC_URL)
    return process.env.SHOP_PUBLIC_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : null;
}

export async function startCheckout(input: {
  lines: CartLine[];
  email: string;
  name: string;
}): Promise<StartCheckoutResult> {
  try {
    const { order, reference } = await placeOrder({
      ...input,
      siteUrl: await siteUrl(),
    });
    return { ok: true, reference, orderId: order.id };
  } catch (err) {
    if (err instanceof CheckoutError) return { ok: false, error: err.message };
    if (err instanceof PryddApiError) {
      console.error(
        "prydd intent create failed",
        err.status,
        err.code,
        err.message,
      );
      return {
        ok: false,
        error: "Prydd could not start this payment. Try again in a moment.",
      };
    }
    console.error("checkout failed", err);
    if (!process.env.DATABASE_URL || !process.env.PRYDD_SECRET_KEY) {
      return {
        ok: false,
        error: "This store is not taking payments yet. Check back shortly.",
      };
    }
    return {
      ok: false,
      error: "Something went wrong starting checkout. Try again.",
    };
  }
}

export async function checkOrder(orderId: string): Promise<Order | null> {
  try {
    return await reconcileOrder(orderId);
  } catch (err) {
    console.error("order check failed", orderId, err);
    return null;
  } finally {
    after(() => reconcileOpenOrders(3).catch(() => undefined));
  }
}

export async function lookupOrders(
  email: string,
  number: string,
): Promise<Order[]> {
  if (!email.trim()) return [];
  return refreshOpen(await ordersFor(email, number.trim() || undefined));
}

export async function recentOrders(ids: string[]): Promise<Order[]> {
  const orders = await refreshOpen(
    await ordersByIds(ids.filter((id) => /^ord_[0-9a-f]{20}$/.test(id))),
  );
  return orders.filter(
    (o) =>
      o.status === "paid" ||
      o.status === "needs_review" ||
      o.status === "awaiting_payment",
  );
}

export async function currentStock(): Promise<Record<string, number>> {
  return displayStock();
}
