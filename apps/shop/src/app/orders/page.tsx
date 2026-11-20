import type { Metadata } from "next";
import { OrdersLookup } from "./OrdersLookup";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage() {
  return <OrdersLookup />;
}
