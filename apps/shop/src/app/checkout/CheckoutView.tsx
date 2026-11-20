"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PryddPayButton } from "@prydd/checkout-react";
import { checkOrder, currentStock, startCheckout } from "@/app/actions";
import { rememberOrder, useBag, writeStorage } from "@/components/CartProvider";
import { ProductArt } from "@/components/ProductArt";
import {
  formatUsd,
  ONE_SIGNATURE_LIMIT_CENTS,
  productById,
  skuFor,
} from "@/lib/catalog";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CheckoutView({
  checkoutOrigin,
  apiBase,
}: {
  checkoutOrigin: string;
  apiBase: string;
}) {
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
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-5 text-center">
        <h1 className="text-[32px] font-medium tracking-[-0.02em]">
          Nothing in here yet.
        </h1>
        <p className="mt-3 text-[15px] text-mute">
          Fourteen objects, from an $8 sticker sheet to a $240 shell.
        </p>
        <Link
          href="/"
          className="mt-8 rounded-full bg-ink px-6 py-3 text-[14px] font-medium text-canvas"
        >
          Browse the issue
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

  const goToOrder = (hint: string) => {
    const id = orderRef.current;
    if (id) router.push(`/orders/${id}?from=${hint}`);
  };

  return (
    <div className="mx-auto grid max-w-[1120px] gap-10 px-5 pt-10 sm:px-8 md:grid-cols-[1fr_420px] md:gap-14 md:pt-14">
      <section>
        <div className="flex items-baseline justify-between border-b border-line pb-5">
          <h1 className="text-[28px] font-medium tracking-[-0.02em]">Bag</h1>
          <button
            type="button"
            onClick={clear}
            className="text-[13px] text-mute hover:text-ink"
          >
            Empty bag
          </button>
        </div>
        <ul className="divide-y divide-line">
          {items.map((i) => {
            const left = stock?.[skuFor(i.productId, i.size)];
            const isShort = left !== undefined && left < i.qty;
            return (
              <li
                key={`${i.productId}-${i.size}`}
                className="flex gap-4 py-5 sm:gap-5"
              >
                <Link
                  href={`/products/${i.product.slug}`}
                  className="w-[84px] shrink-0 overflow-hidden rounded-2xl bg-canvas-2 sm:w-[104px]"
                >
                  <ProductArt
                    kind={i.product.art}
                    tone={i.product.tone}
                    id={`bag-${i.productId}-${i.size}`}
                    label={i.product.name}
                    className="aspect-[4/5] w-full"
                  />
                </Link>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-[15px] font-medium">
                      {i.product.name}
                    </p>
                    <p className="tnum shrink-0 font-medium text-[14px]">
                      {formatUsd(i.product.priceCents * i.qty)}
                    </p>
                  </div>
                  <p className="text-[13px] text-mute">
                    {i.product.line}
                    {i.size ? ` · ${i.size}` : ""}
                  </p>
                  {isShort && (
                    <p className="mt-1 text-[13px] text-alert">
                      {left === 0
                        ? "Sold out. Remove it to continue."
                        : `Only ${left} left. Lower the quantity to continue.`}
                    </p>
                  )}
                  <div className="mt-auto flex items-center gap-1 pt-3">
                    <button
                      type="button"
                      aria-label="Remove one"
                      onClick={() => setQty(i.productId, i.size, i.qty - 1)}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-[16px] hover:border-ink/40"
                    >
                      −
                    </button>
                    <span className="tnum w-8 text-center font-medium text-[14px]">
                      {i.qty}
                    </span>
                    <button
                      type="button"
                      aria-label="Add one"
                      disabled={
                        i.qty >= 5 || (left !== undefined && i.qty >= left)
                      }
                      onClick={() => setQty(i.productId, i.size, i.qty + 1)}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-[16px] hover:border-ink/40 disabled:opacity-30"
                    >
                      +
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <aside className="md:sticky md:top-24 md:self-start">
        <div className="rounded-2xl bg-white p-6 border border-line sm:p-7">
          <dl className="space-y-2.5 text-[14px]">
            <div className="flex justify-between">
              <dt className="text-mute">Subtotal</dt>
              <dd className="tnum font-medium">{formatUsd(total)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-mute">Shipping</dt>
              <dd>Free</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-4">
              <dt className="text-[15px] font-medium">Total</dt>
              <dd className="tnum font-medium text-[26px] tracking-[-0.02em]">
                {formatUsd(total)}
              </dd>
            </div>
          </dl>

          <div className="mt-6 space-y-2.5">
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
                className="h-12 w-full rounded-xl border border-line bg-canvas/50 px-4 text-[15px] outline-none transition-colors placeholder:text-ink/55 focus:border-ink aria-[invalid=true]:border-alert"
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
                className="h-12 w-full rounded-xl border border-line bg-canvas/50 px-4 text-[15px] outline-none transition-colors placeholder:text-ink/55 focus:border-ink aria-[invalid=true]:border-alert"
              />
            </label>
          </div>

          <div className="relative mt-5">
            <div
              className={`pay-hero transition-opacity ${canPay ? "" : "pointer-events-none opacity-35"}`}
              aria-disabled={!canPay}
            >
              <PryddPayButton
                checkoutOrigin={checkoutOrigin}
                apiBase={apiBase}
                theme="light"
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
                onUnresolved={() => goToOrder("pending")}
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
              className={`mt-3 text-[13px] ${error ? "text-alert" : "text-mute"}`}
            >
              {error ??
                notice ??
                (short.length > 0
                  ? "Something in your bag is short on stock."
                  : "Add your email and name to pay.")}
            </p>
          )}

          <div className="mt-6 flex gap-3 border-t border-line pt-5 text-[13px] leading-relaxed text-mute">
            <span
              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${overLimit ? "bg-ink" : "bg-ok"}`}
            />
            <p>
              {overLimit ? (
                <>
                  <span className="font-medium text-ink">
                    Over $100, so your phone approves it.
                  </span>{" "}
                  After you confirm here, the Prydd app shows this order full
                  screen. Approve it there and this page updates on its own.
                </>
              ) : (
                <>
                  <span className="font-medium text-ink">
                    One Face ID and you are done.
                  </span>{" "}
                  Paid in USDC from your Prydd Account. No card number, no form.
                </>
              )}
            </p>
          </div>
        </div>
        <p className="mt-4 px-2 text-center text-[12px] text-mute">
          Prices in US dollars, settled in USDC on Solana. Stock is held when
          your payment confirms.
        </p>
      </aside>
    </div>
  );
}
