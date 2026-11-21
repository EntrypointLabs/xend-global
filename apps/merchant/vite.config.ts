import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { devPilot } from "./dev-pilot";
const backendUrl = process.env.PRYDD_BACKEND_URL ?? "http://127.0.0.1:8008";
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    devPilot(loadEnv(mode, process.cwd(), "").PILOT_DEVNET_API_KEY ?? ""),
  ],
  define:
    mode === "review"
      ? { "import.meta.env.VITE_PRIVY_APP_ID": JSON.stringify("review") }
      : {},
  resolve: {
    dedupe: ["react", "react-dom"],
    // `vite --mode review` swaps Privy for a fixture stub so every route can be
    // inspected without a real sign-in. Never used by a production build.
    alias:
      mode === "review"
        ? {
            "@privy-io/react-auth": fileURLToPath(
              new URL("./review/privy-stub.tsx", import.meta.url),
            ),
          }
        : {},
  },
  server: {
    port: 5174,
    strictPort: true,
    host: "127.0.0.1",
    proxy: {
      "/merchant-portal": backendUrl,
      "/checkout": backendUrl,
    },
  },
}));
