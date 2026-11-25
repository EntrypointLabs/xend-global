import { config } from '@prydd/eslint-config/base';

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    // Fixture and generator tooling is run by hand with Node, never bundled.
    files: ['test/fixtures/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
    rules: { 'turbo/no-undeclared-env-vars': 'off' },
  },
];
