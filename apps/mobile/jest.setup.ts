// App modules do real work at import time: the API client validates its
// environment in its constructor, and the dev seed reads React Native's
// __DEV__. Neither is what any test is about, and neither exists under a plain
// node test environment.
process.env.EXPO_PUBLIC_BACKEND_URL ??= "http://backend.test";
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

// Sentry ships as ESM and pulls in React Native; the modules under test only
// ever call it to report, so a stub is the whole of what a test needs.
jest.mock("@sentry/react-native", () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));
