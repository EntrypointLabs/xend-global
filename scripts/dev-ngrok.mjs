import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { resolveNgrok } from "./ngrok.mjs";

export async function waitForBackend({
  timeout = 180_000,
  interval = 1000,
  signal,
} = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    try {
      const response = await fetch("http://127.0.0.1:8000/health", {
        signal: AbortSignal.timeout(4000),
      });
      if (response.ok && (await response.json()).status === "ok") return;
    } catch {}
    await sleep(interval, undefined, { signal });
  }
  throw new Error(
    "Backend did not become healthy within 180 seconds. Check the backend pane.",
  );
}

export function redactNgrokOutput(line) {
  return line
    .replace(/\b[A-Za-z0-9]{20,}_[A-Za-z0-9]{10,}\b/g, "[REDACTED]")
    .replace(/(Your authtoken:\s*)[^\r\n]+/gi, "$1[REDACTED]");
}

async function main() {
  const binary = resolveNgrok();
  console.log(`[ngrok] Using ${binary}`);
  console.log("[ngrok] Waiting for http://127.0.0.1:8000/health...");
  const controller = new AbortController();
  let child;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      controller.abort();
      child?.kill(signal);
    });
  try {
    await waitForBackend({ signal: controller.signal });
    if (controller.signal.aborted) return;
    // Text logs work inside a Turbo pane and include the public tunnel URL.
    const args = ["http", "8000", "--log=stdout", "--log-format=logfmt"];
    if (process.env.NGROK_CONFIG)
      args.push("--config", process.env.NGROK_CONFIG);
    child = spawn(binary, args, {
      stdio: ["inherit", "pipe", "pipe"],
      env: process.env,
    });
    for (const [source, destination] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ]) {
      createInterface({ input: source }).on("line", (line) =>
        destination.write(`${redactNgrokOutput(line)}\n`),
      );
    }
    child.once("error", (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    child.once("exit", (code, signal) => {
      process.exitCode = code ?? (signal ? 1 : 0);
    });
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error(`[ngrok] ${error.message}`);
      process.exitCode = 1;
    }
  }
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
