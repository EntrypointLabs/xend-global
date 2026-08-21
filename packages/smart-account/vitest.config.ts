import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // LiteSVM loads a 1.7MB program ELF per suite.
    testTimeout: 30_000,
  },
});
