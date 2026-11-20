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
      <section id="everyday" className="px-4 pb-24 pt-24 sm:px-6 sm:pt-28">
        <div className="label mx-auto mb-10 flex max-w-[1400px] flex-col items-center gap-1 text-center text-mute sm:mb-14">
          <p className="text-ink">Issue 01</p>
          <p>Under $100. One Face ID.</p>
        </div>
        <div className="mx-auto grid max-w-[1400px] grid-cols-2 gap-x-4 gap-y-12 sm:grid-cols-3 md:grid-cols-5">
          {everyday.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              stock={productStock(p, levels)}
            />
          ))}
        </div>
      </section>

      <section
        id="over-100"
        className="bg-night px-4 pb-28 pt-24 text-night-text sm:px-6"
      >
        <div className="mx-auto grid max-w-[1400px] gap-x-6 gap-y-6 sm:grid-cols-[1fr_1fr] sm:items-end">
          <h2 className="label text-night-text">Over $100</h2>
          <p className="max-w-[30rem] text-[14px] leading-relaxed text-night-mute sm:justify-self-end sm:text-right">
            Every Prydd Account can sign up to $100 a day with one passkey.
            Above that, the Prydd app on your phone approves the order, and this
            page confirms on its own.
          </p>
        </div>
        <div className="mx-auto mt-14 grid max-w-[1400px] grid-cols-2 gap-x-4 gap-y-12 md:grid-cols-4">
          {premium.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              stock={productStock(p, levels)}
              dark
            />
          ))}
        </div>
      </section>
    </>
  );
}
