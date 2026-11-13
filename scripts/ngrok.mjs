import { accessSync, constants } from "node:fs";
import path from "node:path";

export function resolveNgrok(env = process.env) {
  const override = env.XEND_NGROK_BIN || env.NGROK_BIN;
  const candidates = override
    ? [path.resolve(override)]
    : (env.PATH ?? "")
        .split(path.delimiter)
        .filter(
          (dir) => dir && !dir.replaceAll("\\", "/").includes("node_modules/"),
        )
        .map((dir) =>
          path.join(dir, process.platform === "win32" ? "ngrok.exe" : "ngrok"),
        );
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error(
    "System ngrok not found. Install ngrok v3 or set NGROK_BIN to its absolute path. Expo's bundled ngrok is not used.",
  );
}
