const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const { withNativeWind } = require('nativewind/metro');

const config = getSentryExpoConfig(__dirname);

// Privy's @privy-io/expo pulls in jose (exports-only). Without the "browser"
// resolver condition, Metro picks jose's Node build (dist/node/esm), which
// imports the built-in "crypto" module and fails to bundle on React Native.
// Enabling package exports + the browser condition routes jose to its RN build.
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ["react-native", "browser", "require"];

module.exports = withNativeWind(config, {input: './global.css'});
