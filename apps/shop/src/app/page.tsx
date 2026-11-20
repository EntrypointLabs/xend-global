import Image from "next/image";
import { PRODUCTS, ONE_SIGNATURE_LIMIT_CENTS } from "@/lib/catalog";
import { displayStock } from "@/lib/orders";
import { productStock } from "@/lib/stock";
import { ProductCard } from "@/components/ProductCard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const levels = await displayStock();
  const everyday = PRODUCTS.filter(
    (p) => p.priceCents < ONE_SIGNATURE_LIMIT_CENTS,
  );
  const premium = PRODUCTS.filter(
    (p) => p.priceCents >= ONE_SIGNATURE_LIMIT_CENTS,
  );

  return (
    <>
      <section className="mx-auto grid max-w-[1320px] items-end gap-10 px-5 pb-16 pt-14 sm:px-8 md:grid-cols-[1.15fr_1fr] md:pt-20">
        <div className="rise">
          <p className="text-[13px] font-medium text-mute">
            Issue 01 · Fourteen objects
          </p>
          <h1 className="mt-6 text-[clamp(2.6rem,6.4vw,5.4rem)] font-medium leading-[0.98] tracking-[-0.035em]">
            Things we made.
            <br />
            <span className="text-mute">Paid with a glance.</span>
          </h1>
          <p className="mt-7 max-w-[34rem] text-[16px] leading-relaxed text-ink/70">
            Every order here is a real USDC payment on Solana through Pay with
            Prydd. Under $100 it takes one Face ID. Over $100, your phone
            approves it.
          </p>
          <div className="mt-9 flex flex-wrap gap-3 text-[13px] font-medium">
            <a
              href="#everyday"
              className="rounded-full bg-ink px-5 py-3 text-canvas transition-transform active:scale-[0.97]"
            >
              Shop the issue
            </a>
            <a
              href="#over-100"
              className="rounded-full border border-ink/15 px-5 py-3 transition-colors hover:bg-canvas-2"
            >
              Try a phone approval
            </a>
          </div>
        </div>
        <div
          className="rise relative mx-auto w-full max-w-[240px] md:max-w-[460px]"
          style={{ animationDelay: "120ms" }}
        >
          <div className="absolute inset-x-10 bottom-2 h-10 rounded-[50%] bg-ink/15 blur-2xl" />
          <Image
            src="/sculpted.png"
            alt="The Prydd Passage symbol, sculpted"
            width={1024}
            height={1062}
            priority
            className="relative h-auto w-full"
          />
        </div>
      </section>

      <section
        id="everyday"
        className="mx-auto max-w-[1320px] scroll-mt-20 px-5 sm:px-8"
      >
        <div className="flex items-end justify-between border-t border-line pt-6">
          <div>
            <h2 className="text-[22px] font-medium tracking-[-0.01em]">
              Everyday
            </h2>
            <p className="mt-1 text-[14px] text-mute">
              Under $100. Your passkey, nothing else.
            </p>
          </div>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-5">
          {everyday.map((p, i) => (
            <ProductCard
              key={p.id}
              product={p}
              stock={productStock(p, levels)}
              index={i}
            />
          ))}
        </div>
      </section>

      <section
        id="over-100"
        className="dark-band mt-24 -mb-24 scroll-mt-16 bg-ink text-canvas"
      >
        <div className="mx-auto max-w-[1320px] px-5 py-20 sm:px-8">
          <div className="grid gap-8 md:grid-cols-[1fr_1.2fr] md:items-end">
            <div>
              <h2 className="text-[clamp(2rem,4vw,3.2rem)] font-medium leading-[1.02] tracking-[-0.03em]">
                Big purchases ask
                <br />
                your phone first.
              </h2>
            </div>
            <p className="max-w-[32rem] text-[15px] leading-relaxed text-canvas/60 md:justify-self-end">
              Every Prydd Account has a $100 daily limit for one signature. Go
              over it and the Prydd app on your phone lights up with the order,
              full screen. Approve there and this page confirms on its own.
            </p>
          </div>
          <div className="mt-14 grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:grid-cols-4">
            {premium.map((p, i) => (
              <ProductCard
                key={p.id}
                product={p}
                stock={productStock(p, levels)}
                dark
                index={i}
              />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
