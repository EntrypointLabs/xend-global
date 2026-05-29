// import { AccountInfo } from '@/types/Auth';
import { SessionSecrets } from "@sqds/grid";
import { apiClient } from "@/utils/apiClient";
// import { setupCryptoPolyfill } from '@/polyfills';
// import * as Sentry from '@sentry/react-native';

export const validateEnv = () => {
  if (!process.env.EXPO_PUBLIC_API_ENDPOINT) {
    throw new Error(
      "Missing required environment variables: EXPO_PUBLIC_API_ENDPOINT "
    );
  }
};

/**
 * First time a user registers. Hits NestJS /register so the verifyOtp follow-up
 * can return a JWT (the legacy EAS shim doesn't issue tokens).
 */
export const registerUser = async (email: string): Promise<any> => {
  return apiClient.register(email);
};

export const verifyOtpCodeAndCreateAccount = async (
  code: string,
  sessionSecrets: SessionSecrets,
  user: any
): Promise<any> => {
  return apiClient.verifyOtpAndCreateAccount({
    otpCode: code,
    sessionSecrets,
    user,
  });
};

/**
 * Existing user logs in. Routes through NestJS /auth so verifyOtp can produce a JWT.
 */
export const authenticateUser = async (email: string): Promise<any> => {
  return apiClient.authenticate(email);
};

export const verifyOtpCode = async (
  otpCode: string,
  sessionSecrets: SessionSecrets,
  user: any
): Promise<any> => {
  // NestJS /verify-otp returns `{ ...gridResponse, token }`; the caller in
  // AuthContext.verifyCode extracts `token` and persists via AuthStorage.saveToken.
  return apiClient.verifyOtp({ otpCode, sessionSecrets, user });
};

export const verifyOtpAndCreateAccount = async (
  _code: string
): Promise<void> => {};

// AUTH_STORAGE_KEYS lives in its own module to break the
// `auth.ts → apiClient.ts → authStorage.ts → auth.ts` Metro require cycle.
// Re-exported here so existing `import { AUTH_STORAGE_KEYS } from "@/utils/auth"`
// call sites keep working.
export { AUTH_STORAGE_KEYS } from "@/utils/authStorageKeys";
