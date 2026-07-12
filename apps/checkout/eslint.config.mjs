import { config } from '@xend/eslint-config/react-internal';

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    rules: {
      // import.meta.env is Vite's client env, not a turbo pipeline env var.
      'turbo/no-undeclared-env-vars': 'off',
    },
  },
];
