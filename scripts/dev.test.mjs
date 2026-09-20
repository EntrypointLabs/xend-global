import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveNgrok } from "./ngrok.mjs";
import { waitForBackend, redactNgrokOutput } from "./dev-ngrok.mjs";

test("ngrok ignores npm/Expo shims and selects the system executable", () => {
  const root = mkdtempSync(path.join(tmpdir(), "xend-ngrok-"));
  try {
    const shim = path.join(root, "node_modules/.bin");
    const system = path.join(root, "bin");
    for (const dir of [shim, system]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "ngrok"), "", { mode: 0o755 });
    }
    assert.equal(
      resolveNgrok({ PATH: [shim, system].join(path.delimiter) }),
      path.join(system, "ngrok"),
    );
    assert.throws(() => resolveNgrok({ PATH: shim }), /System ngrok not found/);
    assert.equal(
      resolveNgrok({ PATH: "", NGROK_BIN: path.join(system, "ngrok") }),
      path.join(system, "ngrok"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ngrok waits through network errors and unhealthy responses", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) throw new Error("not listening");
    return {
      ok: calls > 2,
      json: async () => ({ status: calls > 2 ? "ok" : "fail" }),
    };
  };
  try {
    await waitForBackend({ timeout: 1000, interval: 1 });
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = original;
  }
});

test("readiness wait times out and supports cancellation", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false });
  try {
    await assert.rejects(
      waitForBackend({ timeout: 5, interval: 1 }),
      /did not become healthy/,
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(waitForBackend({ signal: controller.signal }), {
      name: "AbortError",
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("ngrok authentication diagnostics redact tokens", () => {
  assert.equal(
    redactNgrokOutput("ERROR: Your authtoken: secret-value"),
    "ERROR: Your authtoken: [REDACTED]",
  );
  assert.equal(
    redactNgrokOutput(
      'err="token AAAAAAAAAAAAAAAAAAAAA_BBBBBBBBBBBBB rejected"',
    ),
    'err="token [REDACTED] rejected"',
  );
  assert.equal(redactNgrokOutput("ERR_NGROK_107"), "ERR_NGROK_107");
});
