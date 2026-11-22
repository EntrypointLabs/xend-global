import type { Metadata } from "next";
import { CheckoutView } from "./CheckoutView";

export const metadata: Metadata = { title: "Bag" };

export default function CheckoutPage() {
  return (
    <CheckoutView
      apiBase={process.env.NEXT_PUBLIC_PRYDD_API_BASE ?? "https://api.prydd.co"}
    />
  );
}
