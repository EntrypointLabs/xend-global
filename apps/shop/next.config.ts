import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@prydd/checkout-react", "@prydd/checkout-core"],
};

export default config;
