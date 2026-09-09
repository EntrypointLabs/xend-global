export const localFiatDemo = __DEV__ && process.env.EXPO_PUBLIC_FIAT_LOCAL_DEMO === "true" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(process.env.EXPO_PUBLIC_BACKEND_URL ?? "");
