import {
  verifyWebhook,
  WebhookVerificationError,
} from "@prydd/checkout-core/webhook";
import { db } from "@/lib/db";
import { findOrderByIntent, reconcileOrder } from "@/lib/orders";

export const runtime = "nodejs";

type PryddEvent = {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: { intent_id: string } };
};

export async function POST(req: Request) {
  const secret = process.env.PRYDD_WEBHOOK_SECRET;
  if (!secret) return new Response("webhook not configured", { status: 503 });

  const raw = await req.text();
  let event: PryddEvent;
  try {
    event = verifyWebhook(
      raw,
      Object.fromEntries(req.headers),
      secret,
    ) as PryddEvent;
  } catch (err) {
    if (err instanceof WebhookVerificationError)
      return new Response(err.code, { status: 400 });
    throw err;
  }

  const sql = await db();
  const fresh = await sql`
    INSERT INTO webhook_events (id, type) VALUES (${event.id}, ${event.type})
    ON CONFLICT (id) DO NOTHING RETURNING id`;
  if (fresh.length === 0) return new Response(null, { status: 200 });

  const order = await findOrderByIntent(event.data.object.intent_id);
  if (order) {
    try {
      // The signed event says which intent moved; the order still settles off the intent read back with the secret key.
      // Forced past the polling throttle; a rate-limited read throws, so the
      // event is released below and Prydd retries it.
      await reconcileOrder(order.id, { force: true });
    } catch (err) {
      await sql`DELETE FROM webhook_events WHERE id = ${event.id}`;
      throw err;
    }
  }
  return new Response(null, { status: 200 });
}
