import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "./db";
import { productById, seedRows, skuFor } from "./catalog";
import {
  createIntent,
  getIntent,
  PryddApiError,
  type PaymentIntent,
} from "./prydd";

export type OrderStatus =
  | "awaiting_payment"
  | "paid"
  | "needs_review"
  | "failed"
  | "expired"
  | "canceled";

export interface OrderItem {
  productId: string;
  size: string | null;
  qty: number;
  name: string;
  line: string;
  unitCents: number;
}

export interface Order {
  id: string;
  number: string;
  email: string;
  name: string;
  items: OrderItem[];
  totalCents: number;
  status: OrderStatus;
  intentId: string | null;
  paymentStatus: string | null;
  note: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface CartLine {
  productId: string;
  size: string | null;
  qty: number;
}

export class CheckoutError extends Error {}

const MAX_QTY = 5;
const OPEN_ORDER_WINDOW_MINUTES = 90;
/** However many tabs or sweeps ask, one order costs at most one API read per window. */
const MIN_CHECK_SECONDS = 4;
/** How long an order waits after the API says it is reading too often. */
const RATE_LIMITED_BACKOFF_SECONDS = 30;

type Row = {
  id: string;
  number: string;
  email: string;
  name: string;
  items: OrderItem[];
  total_cents: number;
  status: OrderStatus;
  intent_id: string | null;
  payment_status: string | null;
  note: string | null;
  created_at: Date;
  paid_at: Date | null;
};

function toOrder(r: Row): Order {
  return {
    id: r.id,
    number: r.number,
    email: r.email,
    name: r.name,
    items: r.items,
    totalCents: r.total_cents,
    status: r.status,
    intentId: r.intent_id,
    paymentStatus: r.payment_status,
    note: r.note,
    createdAt: r.created_at.toISOString(),
    paidAt: r.paid_at ? r.paid_at.toISOString() : null,
  };
}

function orderNumber(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = randomBytes(6);
  return (
    "PR-" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")
  );
}

export async function stockLevels(): Promise<Record<string, number>> {
  const sql = await db();
  const rows = await sql<
    { sku: string; stock: number }[]
  >`SELECT sku, stock FROM inventory`;
  return Object.fromEntries(rows.map((r) => [r.sku, r.stock]));
}

/** For browsing only. Checkout always re-reads stock from the database and refuses if it cannot. */
export async function displayStock(): Promise<Record<string, number>> {
  try {
    return await stockLevels();
  } catch (err) {
    console.error("stock read failed, showing catalogue stock", err);
    return Object.fromEntries(seedRows().map((r) => [r.sku, r.stock]));
  }
}

/** Prices and names are resolved here from the catalog; the browser only names what it wants. */
export async function placeOrder(input: {
  lines: CartLine[];
  email: string;
  name: string;
  siteUrl: string | null;
}): Promise<{ order: Order; reference: string }> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new CheckoutError("Enter a valid email address.");
  if (name.length < 2) throw new CheckoutError("Enter the name for the order.");
  if (input.lines.length === 0) throw new CheckoutError("Your bag is empty.");

  const merged = new Map<string, CartLine>();
  for (const line of input.lines) {
    const product = productById(line.productId);
    if (!product)
      throw new CheckoutError("Something in your bag is no longer sold.");
    const size = product.sizes ? line.size : null;
    if (product.sizes && (!size || !product.sizes.includes(size))) {
      throw new CheckoutError(`Pick a size for the ${product.name}.`);
    }
    const qty = Math.floor(Number(line.qty));
    if (!Number.isFinite(qty) || qty < 1) continue;
    const key = skuFor(product.id, size);
    const prev = merged.get(key);
    merged.set(key, {
      productId: product.id,
      size,
      qty: Math.min(MAX_QTY, (prev?.qty ?? 0) + qty),
    });
  }
  if (merged.size === 0) throw new CheckoutError("Your bag is empty.");

  const stock = await stockLevels();
  const items: OrderItem[] = [];
  for (const [sku, line] of merged) {
    const product = productById(line.productId)!;
    const available = stock[sku] ?? 0;
    const label = line.size ? `${product.name}, ${line.size}` : product.name;
    if (available === 0) throw new CheckoutError(`${label} just sold out.`);
    if (available < line.qty)
      throw new CheckoutError(`Only ${available} left of ${label}.`);
    items.push({
      productId: product.id,
      size: line.size,
      qty: line.qty,
      name: product.name,
      line: product.line,
      unitCents: product.priceCents,
    });
  }
  const totalCents = items.reduce((sum, i) => sum + i.unitCents * i.qty, 0);

  const sql = await db();
  const id = "ord_" + randomBytes(10).toString("hex");
  const number = orderNumber();
  const [row] = await sql<Row[]>`
    INSERT INTO orders (id, number, email, name, items, total_cents)
    VALUES (${id}, ${number}, ${email}, ${name}, ${sql.json(items as never)}, ${totalCents})
    RETURNING *`;

  const publicSite = input.siteUrl?.startsWith("https://")
    ? input.siteUrl
    : null;
  let intent: PaymentIntent;
  try {
    intent = await createIntent({
      amountCents: totalCents,
      orderId: id,
      orderNumber: number,
      returnUrl: publicSite ? `${publicSite}/orders/${id}` : undefined,
      cancelUrl: publicSite ? `${publicSite}/checkout` : undefined,
    });
  } catch (err) {
    await sql`UPDATE orders SET status = 'failed', note = 'Payment could not be started' WHERE id = ${id}`;
    throw err;
  }
  const [updated] = await sql<Row[]>`
    UPDATE orders SET intent_id = ${intent.id}, payment_status = ${intent.status}
    WHERE id = ${id} RETURNING *`;
  return { order: toOrder(updated ?? row), reference: intent.id };
}

export async function findOrder(id: string): Promise<Order | null> {
  const sql = await db();
  const [row] = await sql<Row[]>`SELECT * FROM orders WHERE id = ${id}`;
  return row ? toOrder(row) : null;
}

export async function findOrderByIntent(
  intentId: string,
): Promise<Order | null> {
  const sql = await db();
  const [row] = await sql<
    Row[]
  >`SELECT * FROM orders WHERE intent_id = ${intentId}`;
  return row ? toOrder(row) : null;
}

export async function ordersFor(
  email: string,
  number?: string,
): Promise<Order[]> {
  const sql = await db();
  const e = email.trim().toLowerCase();
  const rows = number
    ? await sql<
        Row[]
      >`SELECT * FROM orders WHERE lower(email) = ${e} AND number = ${number.trim().toUpperCase()}`
    : await sql<
        Row[]
      >`SELECT * FROM orders WHERE lower(email) = ${e} AND intent_id IS NOT NULL ORDER BY created_at DESC LIMIT 20`;
  return rows.map(toOrder);
}

export async function ordersByIds(ids: string[]): Promise<Order[]> {
  if (ids.length === 0) return [];
  const sql = await db();
  const rows = await sql<
    Row[]
  >`SELECT * FROM orders WHERE id = ANY(${ids.slice(0, 20)}) ORDER BY created_at DESC`;
  return rows.map(toOrder);
}

function requireLivemode(): boolean {
  return process.env.PRYDD_ALLOW_TEST_PAYMENTS !== "true";
}

/**
 * The only path that marks an order paid. It reads the intent back from Prydd
 * with the secret key, so neither the browser result nor an unverified request
 * can fulfil anything. Safe to call any number of times.
 */
export async function reconcileOrder(orderId: string): Promise<Order | null> {
  const sql = await db();
  const [row] = await sql<Row[]>`SELECT * FROM orders WHERE id = ${orderId}`;
  if (!row) return null;
  if (row.status !== "awaiting_payment" || !row.intent_id) return toOrder(row);

  // Claim the check in the row itself, so concurrent pollers cannot both read
  // the API for the same order.
  const [claimed] = await sql<Row[]>`
    UPDATE orders SET last_checked_at = now()
    WHERE id = ${orderId}
      AND (last_checked_at IS NULL
           OR last_checked_at < now() - make_interval(secs => ${MIN_CHECK_SECONDS}))
    RETURNING *`;
  if (!claimed) return toOrder(row);

  let intent: PaymentIntent;
  try {
    intent = await getIntent(row.intent_id);
  } catch (err) {
    if (err instanceof PryddApiError && err.status === 429) {
      await sql`
        UPDATE orders
        SET last_checked_at = now() + make_interval(secs => ${RATE_LIMITED_BACKOFF_SECONDS})
        WHERE id = ${orderId}`;
      return toOrder(row);
    }
    throw err;
  }
  await sql`UPDATE orders SET payment_status = ${intent.status} WHERE id = ${orderId}`;

  if (intent.status === "succeeded") return fulfil(row, intent);
  const lapsed =
    intent.status === "created" && Date.parse(intent.expires_at) < Date.now();
  if (
    lapsed ||
    intent.status === "failed" ||
    intent.status === "expired" ||
    intent.status === "canceled"
  ) {
    const status: OrderStatus = lapsed
      ? "expired"
      : (intent.status as OrderStatus);
    const [closed] = await sql<Row[]>`
      UPDATE orders SET status = ${status}
      WHERE id = ${orderId} AND status = 'awaiting_payment' RETURNING *`;
    return toOrder(closed ?? row);
  }
  return findOrder(orderId);
}

async function fulfil(row: Row, intent: PaymentIntent): Promise<Order> {
  const sql = await db();
  const problems: string[] = [];
  if (intent.id !== row.intent_id) problems.push("intent mismatch");
  if (intent.currency !== "USD" || intent.amount !== String(row.total_cents)) {
    problems.push(`amount mismatch: paid ${intent.amount} ${intent.currency}`);
  }
  if (requireLivemode() && !intent.livemode) problems.push("test-mode payment");

  const result = await sql.begin(async (tx) => {
    const [locked] = await tx<
      Row[]
    >`SELECT * FROM orders WHERE id = ${row.id} FOR UPDATE`;
    if (!locked || locked.status !== "awaiting_payment") return locked;

    if (problems.length === 0) {
      for (const item of locked.items) {
        const sku = skuFor(item.productId, item.size);
        const taken = await tx`
          UPDATE inventory SET stock = stock - ${item.qty}
          WHERE sku = ${sku} AND stock >= ${item.qty} RETURNING sku`;
        if (taken.length === 0)
          problems.push(`out of stock at payment: ${sku}`);
      }
    }
    // Money has moved either way, so the order is never left unpaid; anything off goes to review, and units already taken stay held for it.
    const status: OrderStatus = problems.length === 0 ? "paid" : "needs_review";
    const [done] = await tx<Row[]>`
      UPDATE orders
      SET status = ${status}, paid_at = now(), payment_status = 'succeeded',
          note = ${problems.length ? problems.join("; ") : null}
      WHERE id = ${row.id} RETURNING *`;
    return done;
  });
  return toOrder(result!);
}

/** Sweeps recent unpaid orders so a payment confirms even if the shopper closed the tab. */
export async function reconcileOpenOrders(
  limit = 10,
): Promise<{ checked: number; paid: number }> {
  const sql = await db();
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM orders
    WHERE status = 'awaiting_payment' AND intent_id IS NOT NULL
      AND created_at > now() - make_interval(mins => ${OPEN_ORDER_WINDOW_MINUTES})
      AND (last_checked_at IS NULL OR last_checked_at < now() - interval '60 seconds')
    ORDER BY created_at DESC LIMIT ${limit}`;
  let paid = 0;
  for (const { id } of rows) {
    try {
      const order = await reconcileOrder(id);
      if (order?.status === "paid") paid++;
    } catch (err) {
      console.error("reconcile failed", id, err);
    }
  }
  return { checked: rows.length, paid };
}

/** Re-checks any order still waiting so a list never shows a payment abandoned hours ago as pending. */
export async function refreshOpen(orders: Order[]): Promise<Order[]> {
  return Promise.all(
    orders.map(async (o) => {
      if (o.status !== "awaiting_payment" || !o.intentId) return o;
      try {
        return (await reconcileOrder(o.id)) ?? o;
      } catch {
        return o;
      }
    }),
  );
}
