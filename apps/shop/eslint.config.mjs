import { nextJsConfig } from "@prydd/eslint-config/next-js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,
  {
    rules: {
      // Vercel injects these per deployment; they are not turbo pipeline inputs.
      "turbo/no-undeclared-env-vars": "off",
    },
  },
];
