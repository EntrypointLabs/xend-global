import { spawn } from "node:child_process";

const env = { ...process.env };
if (env.XEND_DEV_SUITE === "1") {
  env.PORT = "8000";
  env.RELAYER_URL = env.XEND_RELAYER_URL;
}
const child = spawn("npm", ["run", "dev:standalone"], {
  stdio: "inherit",
  env,
  detached: process.platform !== "win32",
});
function forwardSignal(signal) {
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => forwardSignal(signal));
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
