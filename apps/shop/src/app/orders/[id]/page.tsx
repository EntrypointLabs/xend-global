import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findOrder } from "@/lib/orders";
import { OrderView } from "./OrderView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Order" };

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  if (!/^ord_[0-9a-f]{20}$/.test(id)) notFound();
  const order = await findOrder(id);
  if (!order) notFound();
  return (
    <OrderView
      initial={order}
      fromCheckout={from === "paid" || from === "pending"}
    />
  );
}
