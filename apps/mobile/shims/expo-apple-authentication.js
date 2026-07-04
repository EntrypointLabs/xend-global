// Stub for `expo-apple-authentication`.
//
// Xend authenticates with Privy email OTP only and never invokes Sign in with
// Apple. The real package was removed because its config plugin injects the
// Sign-in-with-Apple entitlement, which a free personal Apple team cannot
// provision. `@privy-io/expo` still imports this module unconditionally for its
// Apple OAuth path, so this stub satisfies the Metro import without pulling the
// native module back in. None of it runs in our flows.

const AppleAuthenticationScope = { FULL_NAME: 0, EMAIL: 1 };

async function isAvailableAsync() {
  return false;
}

async function signInAsync() {
  throw new Error(
    "Sign in with Apple is not available in this build (expo-apple-authentication is intentionally not installed)."
  );
}

module.exports = {
  AppleAuthenticationScope,
  isAvailableAsync,
  signInAsync,
};
