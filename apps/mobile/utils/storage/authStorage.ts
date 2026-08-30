import * as SecureStore from "expo-secure-store";
import { AUTH_STORAGE_KEYS } from "@/utils/auth";

/**
 * The session token, kept in memory once read.
 *
 * Every authenticated request needs it, and on Android `expo-secure-store` is
 * Android Keystore, so reading it per request made the app a steady source of
 * Keystore operations. That is not free: Keystore prunes concurrent operations,
 * and the one it evicts can be a hardware-key signature waiting on a
 * fingerprint. Reading once removes the traffic rather than scheduling around
 * it.
 *
 * `undefined` means not yet read, `null` means read and absent, so a missing
 * token is cached as firmly as a present one.
 */
let cachedToken: string | null | undefined;

export const AuthStorage = {
  async saveIsAuthenticated(isAuthenticated: boolean) {
    await SecureStore.setItemAsync(
      AUTH_STORAGE_KEYS.IS_AUTHENTICATED,
      isAuthenticated ? "true" : "false"
    );
  },

  async isAuthenticated() {
    const isAuthenticated = await SecureStore.getItemAsync(
      AUTH_STORAGE_KEYS.IS_AUTHENTICATED
    );
    return isAuthenticated === "true";
  },

  async saveEmail(email: string) {
    await SecureStore.setItemAsync(AUTH_STORAGE_KEYS.PERSISTENT_EMAIL, email);
  },

  async getEmail() {
    const email = await SecureStore.getItemAsync(
      AUTH_STORAGE_KEYS.PERSISTENT_EMAIL
    );
    return email;
  },

  async saveToken(token: string) {
    cachedToken = token;
    await SecureStore.setItemAsync(AUTH_STORAGE_KEYS.TOKEN, token);
  },

  async getToken() {
    if (cachedToken !== undefined) return cachedToken;
    cachedToken = await SecureStore.getItemAsync(AUTH_STORAGE_KEYS.TOKEN);
    return cachedToken;
  },

  async saveSessionTier(tier: "full" | "entry") {
    await SecureStore.setItemAsync(AUTH_STORAGE_KEYS.SESSION_TIER, tier);
  },

  async getSessionTier(): Promise<"full" | "entry" | null> {
    const tier = await SecureStore.getItemAsync(AUTH_STORAGE_KEYS.SESSION_TIER);
    return tier === "full" || tier === "entry" ? tier : null;
  },

  async saveSessionExpiresAt(iso: string) {
    await SecureStore.setItemAsync(AUTH_STORAGE_KEYS.SESSION_EXPIRES_AT, iso);
  },

  async getSessionExpiresAt() {
    return SecureStore.getItemAsync(AUTH_STORAGE_KEYS.SESSION_EXPIRES_AT);
  },

  async saveUserData(user: any) {
    await SecureStore.setItemAsync(
      AUTH_STORAGE_KEYS.USER,
      JSON.stringify(user)
    );
  },

  async getUser() {
    const user = await SecureStore.getItemAsync(AUTH_STORAGE_KEYS.USER);
    return user ? JSON.parse(user) : null;
  },

  async saveHasPasskey(hasPasskey: boolean) {
    await SecureStore.setItemAsync(
      AUTH_STORAGE_KEYS.HAS_PASSKEY,
      hasPasskey ? "true" : "false"
    );
  },

  async getHasPasskey(): Promise<boolean> {
    const value = await SecureStore.getItemAsync(AUTH_STORAGE_KEYS.HAS_PASSKEY);
    return value === "true";
  },

  async clearAuthData() {
    cachedToken = null;
    await Promise.all([
      SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.USER),
      SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.EMAIL),
      SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.TOKEN),
      SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.SESSION_TIER),
      SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.SESSION_EXPIRES_AT),
      SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.IS_AUTHENTICATED),
      SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.KYC_STATUS),
      SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.KYC_LINK),
      SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.PERSISTENT_EMAIL),
      SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.CACHED_BALANCE),
      SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.HAS_PASSKEY),
      // Contacts and wallet name are stored under per-user keys
      // (address_book:<userId> / wallet_name:<userId>), so they survive logout
      // and a different user can't see them. Not cleared here.
    ]);
  },
};
