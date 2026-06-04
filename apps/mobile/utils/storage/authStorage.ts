import * as SecureStore from "expo-secure-store";
import { AUTH_STORAGE_KEYS } from "@/utils/auth";

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
    await SecureStore.setItemAsync(AUTH_STORAGE_KEYS.TOKEN, token);
  },

  async getToken() {
    return SecureStore.getItemAsync(AUTH_STORAGE_KEYS.TOKEN);
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
    await Promise.all([
      SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.USER),
      SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.EMAIL),
      SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.TOKEN),
      SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.IS_AUTHENTICATED),
      SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.KYC_STATUS),
      SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.KYC_LINK),
      SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.PERSISTENT_EMAIL),
      SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.CACHED_BALANCE),
      SecureStore.deleteItemAsync(AUTH_STORAGE_KEYS.HAS_PASSKEY),
    ]);
  },
};
