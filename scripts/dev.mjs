#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveNgrok } from "./ngrok.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INFRA_SERVICES = ["redis", "kafka", "kafka-topics"];
const DOCKER_START_TIMEOUT_MS = 90_000;

const args = process.argv.slice(2);
const logFlag = args.indexOf("--log");
const logArg = logFlag === -1 ? undefined : args[logFlag + 1];
const logPath =
  logFlag === -1
    ? null
    : path.resolve(
        ROOT,
        logArg && !logArg.startsWith("--") ? logArg : "/tmp/xend-dev.log",
      );

const say = (msg) => console.log(`[dev] ${msg}`);
const die = (msg) => {
  console.error(`\n[dev] ${msg}\n`);
  process.exit(1);
};

function run(cmd, cmdArgs, opts = {}) {
  return spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: "utf8", ...opts });
}

function envValue(envFile, key) {
  const file = path.join(ROOT, envFile);
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match?.[1] === key) return match[2].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

function isListening(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    const settle = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(700);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

function portHolder(port) {
  const { stdout } = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
  const line = (stdout ?? "").split("\n")[1];
  if (!line) return null;
  const [command, pid] = line.split(/\s+/);
  return { command, pid };
}

async function ensureDockerDaemon() {
  if (run("docker", ["info"]).status === 0) return;

  if (process.platform !== "darwin") {
    die(
      "Docker daemon is not reachable. Start Docker, then re-run `npm run dev`.",
    );
  }

  say("Docker daemon is not reachable, starting Docker Desktop...");
  run("open", ["-a", "Docker"]);

  const deadline = Date.now() + DOCKER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(2000);
    if (run("docker", ["info"]).status === 0) {
      say("Docker daemon is up.");
      return;
    }
  }
  die(
    "Docker Desktop did not come up in time. Start it manually, then re-run `npm run dev`.",
  );
}

function startInfra() {
  say(`Bringing up infra: ${INFRA_SERVICES.join(", ")}`);
  const result = run(
    "docker",
    ["compose", "up", "-d", "--wait", ...INFRA_SERVICES],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    die(
      "`docker compose up` failed. See the output above; `npm run infra:reset` clears a wedged broker.",
    );
  }
  say("Redis and Kafka are healthy, lifecycle topics seeded.");
}

async function checkPostgres() {
  const url = envValue("apps/backend/.env", "DATABASE_URL");
  if (!url) {
    die(
      "apps/backend/.env is missing DATABASE_URL. Copy apps/backend/.env.example and fill it in.",
    );
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    die("DATABASE_URL in apps/backend/.env is not a valid URL.");
  }

  const host = parsed.hostname || "localhost";
  const port = Number(parsed.port || 5432);
  if (await isListening(port, host)) {
    say(`Postgres is reachable on ${host}:${port}.`);
    return;
  }

  die(
    `Postgres is not accepting connections on ${host}:${port} (DATABASE_URL in apps/backend/.env).\n` +
      "       Start your local server (`brew services start postgresql@17`), or run the\n" +
      "       bundled one with `docker compose --profile postgres up -d --wait postgres`.\n" +
      "       A Homebrew server that refuses to start usually has a stale lock:\n" +
      "       rm -f /opt/homebrew/var/postgresql@17/postmaster.pid && brew services restart postgresql@17",
  );
}

async function checkServicePorts() {
  const wanted = [
    {
      label: "backend",
      port: 8000,
    },
    {
      label: "relayer",
      port: Number(
        process.env.PORT ?? envValue("apps/relayer/.env", "PORT") ?? 8787,
      ),
    },
    // A busy 8081 makes `expo start` prompt for an alternate port, and it has no
    // terminal to answer from once Turbo owns the process.
    { label: "mobile (Metro)", port: 8081 },
    { label: "merchant", port: 5174 },
    { label: "checkout", port: checkoutPort() },
  ];

  const taken = [];
  for (const { label, port } of wanted) {
    if (await isListening(port))
      taken.push({ label, port, holder: portHolder(port) });
  }
  if (taken.length === 0) return;

  const lines = taken.map(
    ({ label, port, holder }) =>
      `       ${label} port ${port} held by ${holder ? `${holder.command} (pid ${holder.pid})` : "an unknown process"}`,
  );
  const pids = taken.map((t) => t.holder?.pid).filter(Boolean);
  die(
    "Another dev server is already holding a port this suite needs:\n" +
      `${lines.join("\n")}\n\n` +
      (pids.length ? `       Free them with: kill ${pids.join(" ")}` : ""),
  );
}

function checkoutPort() {
  const candidates = process.env.XEND_CHECKOUT_HOST
    ? [{ host: process.env.XEND_CHECKOUT_HOST, port: 443 }]
    : [
        { host: "www.xend.global", port: 443 },
        { host: "pay.xend.global", port: 5173 },
      ];
  const active = candidates.find(({ host }) =>
    [".pem", "-key.pem"].every((suffix) =>
      existsSync(path.join(ROOT, "apps/checkout/certs", host + suffix)),
    ),
  );
  return active?.port ?? 5173;
}

function startServices() {
  const ui = !logPath && process.stdout.isTTY ? "tui" : "stream";
  say(`Starting all apps and ngrok in Turbo (${ui}).`);
  const child = spawn(
    path.join(ROOT, "node_modules/.bin/turbo"),
    [
      "run",
      "dev",
      "//#dev:ngrok",
      "--continue=always",
      "--env-mode=loose",
      `--ui=${ui}`,
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        XEND_DEV_SUITE: "1",
        XEND_NGROK_BIN: ngrokBin,
        XEND_BACKEND_URL: "http://127.0.0.1:8000",
        XEND_RELAYER_URL: `http://127.0.0.1:${process.env.PORT ?? envValue("apps/relayer/.env", "PORT") ?? 8787}`,
        XEND_VITE_CACHE_DIR:
          process.env.XEND_VITE_CACHE_DIR ??
          path.join(ROOT, "node_modules/.cache/xend-checkout"),
      },
      stdio: logPath ? ["inherit", "pipe", "pipe"] : "inherit",
    },
  );
  const sink = logPath ? createWriteStream(logPath, { flags: "w" }) : null;
  if (sink) {
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    child.stdout.pipe(sink, { end: false });
    child.stderr.pipe(sink, { end: false });
    sink.on("error", (error) => {
      console.error(`[dev] Cannot write log: ${error.message}`);
      child.kill("SIGTERM");
      process.exitCode = 1;
    });
  }
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => child.kill(signal));
  }
  child.once("error", (error) => {
    console.error(`[dev] Turbo could not start: ${error.message}`);
    sink?.end();
    process.exitCode = 1;
  });
  child.once("close", (code, signal) => {
    sink?.end();
    process.exitCode = process.exitCode || code || (signal ? 1 : 0);
  });
}

// npm prepends Expo's legacy ngrok v2 shim to PATH. Resolve outside those dirs.
const ngrokBin = resolveNgrok();
say(`ngrok binary: ${ngrokBin}`);
await checkServicePorts();
await ensureDockerDaemon();
startInfra();
await checkPostgres();
say("Building shared packages...");
if (
  run("npx", ["turbo", "run", "build", "--filter=./packages/*"], {
    stdio: "inherit",
  }).status !== 0
) {
  die(
    "Shared package build failed. Fix the errors above before starting the apps.",
  );
}
await startServices();
