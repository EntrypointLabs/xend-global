const path = require("path");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const { withNativeWind } = require('nativewind/metro');

const config = getSentryExpoConfig(__dirname);

// Privy's @privy-io/expo pulls in jose (exports-only). Without the "browser"
// resolver condition, Metro picks jose's Node build (dist/node/esm), which
// imports the built-in "crypto" module and fails to bundle on React Native.
// Enabling package exports + the browser condition routes jose to its RN build.
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ["react-native", "browser", "require"];

// @privy-io/expo imports expo-apple-authentication unconditionally for its Apple
// OAuth path. That package was removed (its config plugin injects a Sign-in-with-
// Apple entitlement a free Apple team can't provision), so alias the import to a
// local stub — Xend uses Privy email OTP only and never triggers Apple sign-in.
const appleAuthShim = path.resolve(__dirname, "shims/expo-apple-authentication.js");
const baseResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "expo-apple-authentication") {
    return { type: "sourceFile", filePath: appleAuthShim };
  }
  return (baseResolveRequest ?? context.resolveRequest)(
    context,
    moduleName,
    platform
  );
};

module.exports = withNativeWind(config, {input: './global.css'});
