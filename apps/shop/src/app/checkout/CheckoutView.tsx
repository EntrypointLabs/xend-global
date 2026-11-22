"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PryddPayButton } from "@prydd/checkout-react";
import {
  checkOrder,
  checkOrderNow,
  currentStock,
  startCheckout,
} from "@/app/actions";
import { rememberOrder, useBag, writeStorage } from "@/components/CartProvider";
import { ProductArt } from "@/components/ProductArt";
import {
  formatUsd,
  ONE_SIGNATURE_LIMIT_CENTS,
  productById,
  skuFor,
} from "@/lib/catalog";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CheckoutView({ apiBase }: { apiBase: string }) {
  const router = useRouter();
  const { lines, ready, setQty, clear } = useBag();
  const [stock, setStock] = useState<Record<string, number> | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const orderRef = useRef<string | null>(null);
  const [watching, setWatching] = useState<string | null>(null);

  useEffect(() => {
    if (!watching) return;
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      if (stopped) return;
      const order = await checkOrder(watching).catch(() => null);
      if (stopped) return;
      if (order?.status === "paid" || order?.status === "needs_review") {
        clear();
        router.push(`/orders/${watching}?from=paid`);
        return;
      }
      if (order && order.status !== "awaiting_payment") return;
      if (Date.now() - started < 15 * 60_000) timer = setTimeout(tick, 3000);
    };
    let timer = setTimeout(tick, 3000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [watching, clear, router]);

  useEffect(() => {
    currentStock()
      .then(setStock)
      .catch(() => setStock({}));
    try {
      const saved = JSON.parse(
        localStorage.getItem("prydd-shop-contact") ?? "{}",
      );
      if (saved.email) setEmail(saved.email);
      if (saved.name) setName(saved.name);
    } catch {
      // Nothing saved, or storage is blocked: the fields start empty.
    }
  }, []);

  const items = lines
    .map((l) => ({ ...l, product: productById(l.productId) }))
    .filter((l): l is typeof l & { product: NonNullable<typeof l.product> } =>
      Boolean(l.product),
    );
  const total = items.reduce((n, i) => n + i.product.priceCents * i.qty, 0);
  const overLimit = total >= ONE_SIGNATURE_LIMIT_CENTS;
  const short = items.filter(
    (i) => stock && (stock[skuFor(i.productId, i.size)] ?? 0) < i.qty,
  );
  const emailOk = EMAIL.test(email.trim());
  const nameOk = name.trim().length >= 2;
  const canPay = items.length > 0 && emailOk && nameOk && short.length === 0;

  if (!ready) return <div className="min-h-[60vh]" />;

  if (items.length === 0) {
    return (
      <div className="flex min-h-[80vh] flex-col items-center justify-center px-4 text-center">
        <p className="label">Your bag is empty</p>
        <p className="label mt-1 text-mute">Items you add will appear here</p>
        <Link href="/" className="label mt-8 bg-ink px-6 py-3 text-white">
          Continue shopping
        </Link>
      </div>
    );
  }

  const createIntent = async () => {
    setError(null);
    setNotice(null);
    writeStorage("prydd-shop-contact", {
      email: email.trim(),
      name: name.trim(),
    });
    const res = await startCheckout({
      lines: items.map(({ productId, size, qty }) => ({
        productId,
        size,
        qty,
      })),
      email,
      name,
    });
    if (!res.ok) {
      setError(res.error);
      currentStock()
        .then(setStock)
        .catch(() => undefined);
      throw new Error(res.error);
    }
    orderRef.current = res.orderId;
    rememberOrder(res.orderId);
    setWatching(res.orderId);
    return { reference: res.reference };
  };

  const settleClosedWindow = async () => {
    const id = orderRef.current;
    const order = id ? await checkOrderNow(id).catch(() => null) : null;
    if (order?.status === "paid" || order?.status === "needs_review") {
      clear();
      goToOrder("paid");
      return;
    }
    // Only a payment Prydd says was never started is safe to start again.
    // Anything else, including not knowing, is shown as pending.
    if (
      order?.status !== "awaiting_payment" ||
      order.paymentStatus !== "created"
    ) {
      goToOrder("pending");
      return;
    }
    setNotice("The payment wasn't finished. Tap Pay with Prydd to try again.");
  };

  const goToOrder = (hint: string) => {
    const id = orderRef.current;
    if (id) router.push(`/orders/${id}?from=${hint}`);
  };

  const field =
    "h-12 w-full border border-night-line bg-transparent px-3.5 text-[14px] text-night-text outline-none transition-colors placeholder:uppercase placeholder:tracking-[0.04em] placeholder:text-[12px] placeholder:font-mono placeholder:text-night-mute focus:border-night-text aria-[invalid=true]:border-alert";

  return (
    <div className="grid min-h-dvh md:grid-cols-[1fr_minmax(380px,40%)]">
      <section className="px-4 pb-16 pt-20 sm:px-6 md:pt-24">
        <div className="mx-auto max-w-[620px]">
          <div className="label flex items-baseline justify-between">
            <h1>Bag</h1>
            <button
              type="button"
              onClick={clear}
              className="text-mute hover:text-ink"
            >
              Empty bag
            </button>
          </div>
          <ul className="mt-6 border-t border-line">
            {items.map((i) => {
              const left = stock?.[skuFor(i.productId, i.size)];
              const isShort = left !== undefined && left < i.qty;
              return (
                <li
                  key={`${i.productId}-${i.size}`}
                  className="flex gap-4 border-b border-line py-4"
                >
                  <Link
                    href={`/products/${i.product.slug}`}
                    className="w-[76px] shrink-0 sm:w-[92px]"
                  >
                    <ProductArt
                      kind={i.product.art}
                      tone={i.product.tone}
                      id={`bag-${i.productId}-${i.size}`}
                      label={i.product.name}
                      className="aspect-[4/5] w-full"
                    />
                  </Link>
                  <div className="label flex min-w-0 flex-1 flex-col py-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="truncate">
                        {i.product.code} {i.product.name}
                      </p>
                      <p className="tnum shrink-0">
                        {formatUsd(i.product.priceCents * i.qty)}
                      </p>
                    </div>
                    <p className="text-mute">
                      {i.product.line}
                      {i.size ? ` · ${i.size}` : ""}
                    </p>
                    {isShort && (
                      <p className="mt-1 text-alert">
                        {left === 0
                          ? "Sold out. Remove it to continue"
                          : `Only ${left} left. Lower the quantity`}
                      </p>
                    )}
                    <div className="mt-auto flex items-center pt-3">
                      <button
                        type="button"
                        aria-label="Remove one"
                        onClick={() => setQty(i.productId, i.size, i.qty - 1)}
                        className="flex h-7 w-7 items-center justify-center border border-line hover:border-ink"
                      >
                        −
                      </button>
                      <span className="tnum w-9 text-center">{i.qty}</span>
                      <button
                        type="button"
                        aria-label="Add one"
                        disabled={
                          i.qty >= 5 || (left !== undefined && i.qty >= left)
                        }
                        onClick={() => setQty(i.productId, i.size, i.qty + 1)}
                        className="flex h-7 w-7 items-center justify-center border border-line hover:border-ink disabled:opacity-30"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <aside className="bg-night px-4 pb-16 pt-12 text-night-text sm:px-6 md:pt-24">
        <div className="mx-auto max-w-[420px] md:sticky md:top-24">
          <dl className="label space-y-2">
            <div className="flex justify-between text-night-mute">
              <dt>Subtotal</dt>
              <dd className="tnum">{formatUsd(total)}</dd>
            </div>
            <div className="flex justify-between text-night-mute">
              <dt>Shipping</dt>
              <dd>Free</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-night-line pt-4">
              <dt>Total</dt>
              <dd className="tnum font-sans text-[28px] tracking-[-0.02em] normal-case">
                {formatUsd(total)}
              </dd>
            </div>
          </dl>

          <div className="mt-8 space-y-1.5">
            <label className="block">
              <span className="sr-only">Email</span>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="Email for your receipt"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched(true)}
                aria-invalid={touched && !emailOk}
                className={field}
              />
            </label>
            <label className="block">
              <span className="sr-only">Name</span>
              <input
                autoComplete="name"
                placeholder="Name on the order"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTouched(true)}
                aria-invalid={touched && !nameOk}
                className={field}
              />
            </label>
          </div>

          <div className="relative mt-3">
            <div
              className={`pay-hero transition-opacity ${canPay ? "" : "pointer-events-none opacity-30"}`}
              aria-disabled={!canPay}
            >
              <PryddPayButton
                apiBase={apiBase}
                theme="dark"
                createIntent={createIntent}
                onResult={(result) => {
                  if (result.status === "succeeded") {
                    clear();
                    goToOrder("paid");
                  } else if (result.status === "canceled") {
                    setWatching(null);
                    setNotice("Payment canceled. Your bag is still here.");
                  } else if (result.status === "expired") {
                    setNotice(
                      "That payment expired. Tap Pay to start a fresh one.",
                    );
                  } else {
                    setNotice(
                      "The payment did not go through. Nothing was charged.",
                    );
                  }
                }}
                onUnresolved={(u) => {
                  // The SDK is sending this whole page to Prydd to finish the
                  // payment. Navigating here as well would cancel that.
                  if (u.reason === "redirected" || u.reason === "popup_blocked")
                    return;
                  // A payment that may really be in flight gets the order page,
                  // which keeps checking until it settles.
                  if (u.reason === "confirmation_timeout") {
                    goToOrder("pending");
                    return;
                  }
                  // The Prydd window closed without a result. It may have closed
                  // after the payment was submitted, so ask Prydd before
                  // offering a second payment for the same bag.
                  void settleClosedWindow();
                }}
              />
            </div>
            {!canPay && (
              <button
                type="button"
                className="absolute inset-0 cursor-not-allowed"
                aria-label="Add your email and name to pay"
                onClick={() => setTouched(true)}
              />
            )}
          </div>

          {(error || notice || (touched && !canPay)) && (
            <p
              role="status"
              className={`mt-3 text-[13px] ${error ? "text-[#ff6b61]" : "text-night-mute"}`}
            >
              {error ??
                notice ??
                (short.length > 0
                  ? "Something in your bag is short on stock."
                  : "Add your email and name to pay.")}
            </p>
          )}

          <div className="mt-8 border-t border-night-line pt-5">
            <p className="label">
              {overLimit
                ? "Over $100: your phone approves it"
                : "Under $100: one Face ID"}
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-night-mute">
              {overLimit
                ? "After you confirm here, the Prydd app shows this order full screen. Approve it there and this page updates on its own."
                : "Paid in USDC from your Prydd Account. No card number, no form."}
            </p>
          </div>
          <p className="label mt-10 text-night-mute">
            Settled in USDC on Solana. Stock is held when payment confirms.
          </p>
        </div>
      </aside>
    </div>
  );
}
