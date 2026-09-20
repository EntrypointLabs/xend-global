import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { devPilot } from "./dev-pilot";
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    devPilot(loadEnv(mode, process.cwd(), "").PILOT_DEVNET_API_KEY ?? ""),
  ],
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    port: 5174,
    host: "127.0.0.1",
    proxy: {
      "/merchant-portal": "http://127.0.0.1:8008",
      "/checkout": "http://127.0.0.1:8008",
    },
  },
}));
