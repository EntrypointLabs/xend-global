import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: { index: "src/index.ts", "webhook/verify": "src/webhook/verify.ts" },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
  },
  {
    entry: { "xend-checkout": "src/index.ts" },
    format: ["iife"],
    globalName: "XendCheckout",
    minify: true,
    dts: false,
  },
]);
