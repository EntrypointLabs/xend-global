import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";
import prettierConfig from "eslint-config-prettier";

export default defineConfig([
  ...expoConfig,
  prettierConfig,
  {
    ignores: ["node_modules/", ".expo/", "dist/", "android/", "ios/"],
  },
]);
