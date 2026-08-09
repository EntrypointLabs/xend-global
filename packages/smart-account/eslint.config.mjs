import { config } from '@xend/eslint-config/base';

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    // Fixture tooling is a Node script run by hand, never bundled.
    files: ['test/fixtures/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
    rules: { 'turbo/no-undeclared-env-vars': 'off' },
  },
];
