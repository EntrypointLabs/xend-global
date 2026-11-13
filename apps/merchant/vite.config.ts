import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { devPilot } from "./dev-pilot";
const backendUrl = process.env.XEND_BACKEND_URL ?? "http://127.0.0.1:8008";
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    devPilot(loadEnv(mode, process.cwd(), "").PILOT_DEVNET_API_KEY ?? ""),
  ],
  resolve: { dedupe: ["react", "react-dom"] },
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
