import type { Plugin } from "vite";
import { readFileSync } from "node:fs";

/** Local integration harness. Never installs middleware in a production build. */
export function devPilot(key: string): Plugin {
  const orders = {
    "usd-one": { currency: "USD", amount: "100" },
    "ngn-small": { currency: "NGN", amount: "100000" },
    insufficient: { currency: "USD", amount: "1000" },
  };
  return {
    name: "local-devnet-payment-pilot",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = req.url?.split("?")[0];
        if (pathname === "/pilot" && req.method === "GET") {
          res.setHeader("Content-Type", "text/html");
          res.end(readFileSync(new URL("./pilot.html", import.meta.url)));
          return;
        }
        if (pathname === "/pilot-sdk.js" && req.method === "GET") {
          res.setHeader("Content-Type", "text/javascript");
          res.end(
            readFileSync(
              new URL(
                "../../packages/checkout-core/dist/xend-checkout.iife.js",
                import.meta.url,
              ),
            ),
          );
          return;
        }
        if (pathname !== "/pilot/intents") return next();
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        if (
          req.method !== "POST" ||
          req.headers.origin !== "http://localhost:5174"
        ) {
          res.statusCode = 403;
          res.end(JSON.stringify({ message: "Local pilot origin required" }));
          return;
        }
        try {
          if (!key)
            throw new Error(
              "Configure PILOT_DEVNET_API_KEY on the local Merchant server",
            );
          let body = "";
          for await (const chunk of req) {
            body += String(chunk);
            if (body.length > 1024) throw new Error("Request too large");
          }
          const input = JSON.parse(body) as {
            order: keyof typeof orders;
            idempotencyKey: string;
          };
          if (
            !Object.hasOwn(orders, input.order) ||
            !/^[a-f0-9-]{36}$/.test(input.idempotencyKey)
          )
            throw new Error("Invalid pilot order");
          const upstream = await fetch(
            "http://127.0.0.1:8008/v1/payment_intents",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
                "Idempotency-Key": input.idempotencyKey,
              },
              body: JSON.stringify(orders[input.order]),
            },
          );
          res.statusCode = upstream.status;
          res.end(await upstream.text());
        } catch (error) {
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              message:
                error instanceof Error ? error.message : "Pilot request failed",
            }),
          );
        }
      });
    },
  };
}
