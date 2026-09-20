import { config } from '@xend/eslint-config/react-internal';

export default [
  ...config,
  {
    rules: {
      // Vite loads client and local-pilot configuration outside Turbo tasks.
      'turbo/no-undeclared-env-vars': 'off',
    },
  },
];
