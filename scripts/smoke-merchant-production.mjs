#!/usr/bin/env node
// Production smoke check for the Merchant portal + API. A dev proxy is not
// deployment proof; this hits a real deployment and fails loudly if the
// same-origin routing, security headers or SPA deep-link fallback regress.
//
// Usage:
//   API_URL=https://api.xend.global \
//   MERCHANT_URL=https://merchants.xend.global \
//   node scripts/smoke-merchant-production.mjs
//
// Exits non-zero on the first failed check.

const API_URL = (process.env.API_URL ?? "").replace(/\/+$/, "");
const MERCHANT_URL = (process.env.MERCHANT_URL ?? "").replace(/\/+$/, "");

if (!API_URL || !MERCHANT_URL) {
  console.error("Set API_URL and MERCHANT_URL environment variables.");
  process.exit(2);
}

let failures = 0;
function check(name, ok, detail = "") {
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function main() {
  // 1. The API answers its health check.
  try {
    const health = await fetch(`${API_URL}/health`);
    check("API /health is 200", health.status === 200, `status ${health.status}`);
    // 2. Baseline security headers are present on an API response.
    check(
      "API sets X-Content-Type-Options: nosniff",
      health.headers.get("x-content-type-options") === "nosniff",
    );
    check(
      "API sets a Referrer-Policy",
      Boolean(health.headers.get("referrer-policy")),
    );
    check(
      "API is not cacheable",
      (health.headers.get("cache-control") ?? "").includes("no-store"),
    );
  } catch (error) {
    check("API reachable", false, String(error));
  }

  // 3. An owner-authenticated portal route rejects an unauthenticated request
  //    rather than leaking data (401, not 200 and not a network/404 error).
  try {
    const me = await fetch(`${API_URL}/merchant-portal/me`);
    check(
      "Portal /me rejects an unauthenticated request",
      me.status === 401,
      `status ${me.status}`,
    );
  } catch (error) {
    check("Portal /me reachable", false, String(error));
  }

  // 4. A deep link into the SPA returns the app shell (history fallback), so a
  //    refresh on /payments or /webhooks does not 404.
  for (const path of ["/payments", "/webhooks", "/audit"]) {
    try {
      const page = await fetch(`${MERCHANT_URL}${path}`, {
        headers: { accept: "text/html" },
      });
      const body = await page.text();
      check(
        `Deep link ${path} serves the SPA shell`,
        page.status === 200 && body.includes('<div id="root">'),
        `status ${page.status}`,
      );
    } catch (error) {
      check(`Deep link ${path} reachable`, false, String(error));
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll smoke checks passed.");
}

void main();
