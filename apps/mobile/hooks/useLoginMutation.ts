import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  useEmbeddedSolanaWallet,
  useIdentityToken,
  useLoginWithEmail,
} from "@privy-io/expo";

import { apiClient } from "@/utils/apiClient";
import { SDKGridClient } from "@/grid/sdkClient";
import { useNewStack } from "@/utils/featureFlags";

/**
 * Login mutation hook. Selects implementation at the mutationFn level (not
 * at the hook level) so the rules of hooks are honoured: Privy hooks are
 * always invoked at the top, mounted under `<PrivyProvider>` in
 * `app/_layout.tsx::PrivyAppShell` which is now an unconditional wrap.
 *
 * Branch behaviour:
 *
 *   - Flag OFF (legacy Grid): `sendOtpAsync` → `/auth` with fallback to
 *     `/register`; `verifyOtpAsync` → `/verify-otp[-and-create-account]`
 *     with Grid session-secrets. Identical to pre-Phase-4.
 *   - Flag ON (Privy): `sendOtpAsync` → `sendCode({ email })`;
 *     `verifyOtpAsync` → `loginWithCode({ code })` → `getIdentityToken()` →
 *     `apiClient.exchange({ privyIdToken })`.
 *
 * Return shape is identical in both branches:
 *   - `sendOtpAsync(email): Promise<{ data: any }>`
 *   - `verifyOtpAsync(code): Promise<{ data: any; token: string }>`
 *     where `data` carries `smart_account_address` so legacy field-name
 *     readers (`email-login.tsx` post-login passkey check) keep working.
 */
export function useLoginMutation() {
  const [isNewUser, setIsNewUser] = useState(false);
  const userContextRef = useRef<any>(null);
  const emailRef = useRef<string>("");
  const newStack = useNewStack();

  // Privy hooks — safe to call unconditionally because `<PrivyProvider>` is
  // always mounted (see `app/_layout.tsx::PrivyAppShell`). They are read at
  // call-time inside the mutationFn so the legacy branch never invokes
  // their methods.
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { getIdentityToken } = useIdentityToken();
  const embeddedSolana = useEmbeddedSolanaWallet();

  const sendOtpMutation = useMutation({
    mutationFn: async (email: string) => {
      emailRef.current = email;

      if (newStack) {
        await sendCode({ email });
        // Privy collapses register and login into the same OTP flow; the
        // `isNewUser` distinction is settled by /auth/exchange when the OTP
        // is verified.
        setIsNewUser(false);
        return { data: { email } };
      }

      try {
        // Try login first
        const result = await apiClient.authenticate(email);
        setIsNewUser(false);
        userContextRef.current = result.data;
        return result;
      } catch (error: any) {
        // If user not found or not registered, fall back to registration
        const status = error?.status;
        const code = error?.data?.code;
        if (
          status === 401 ||
          status === 404 ||
          code === "USER_NOT_FOUND" ||
          code === "UNAUTHORIZED"
        ) {
          const result = await apiClient.register(email);
          setIsNewUser(true);
          userContextRef.current = result.data;
          return result;
        }
        throw error;
      }
    },
  });

  const verifyOtpMutation = useMutation({
    mutationFn: async (otpCode: string) => {
      if (newStack) {
        const privyUser = await loginWithCode({ code: otpCode });
        if (!privyUser) {
          throw new Error("Privy loginWithCode returned no user");
        }
        const idToken = await getIdentityToken();
        if (!idToken) {
          throw new Error(
            "Privy did not return an identity token after loginWithCode"
          );
        }
        const exchange = await apiClient.exchange({ privyIdToken: idToken });
        setIsNewUser(exchange.user.isNewUser);

        const data = {
          id: exchange.user.id,
          email: exchange.user.email,
          walletAddress: exchange.user.walletAddress,
          // Keep the legacy field name alive for the screen's existing
          // post-login passkey check, which reads `smart_account_address`.
          smart_account_address: exchange.user.walletAddress,
          privyWalletAddress: embeddedSolana.wallets?.[0]?.address ?? null,
        };
        return { data, token: exchange.token };
      }

      const gridClient = SDKGridClient.getFrontendClient();
      const sessionSecrets = await gridClient.generateSessionSecrets();

      const request = {
        otpCode,
        sessionSecrets,
        user: userContextRef.current,
      };

      if (isNewUser) {
        return apiClient.verifyOtpAndCreateAccount(request);
      }
      return apiClient.verifyOtp(request);
    },
  });

  return {
    sendOtp: sendOtpMutation.mutate,
    sendOtpAsync: sendOtpMutation.mutateAsync,
    verifyOtp: verifyOtpMutation.mutate,
    verifyOtpAsync: verifyOtpMutation.mutateAsync,
    isNewUser,
    isSendingOtp: sendOtpMutation.isPending,
    isVerifying: verifyOtpMutation.isPending,
    sendOtpError: sendOtpMutation.error,
    verifyError: verifyOtpMutation.error,
    otpSent: sendOtpMutation.isSuccess,
    // Email is captured into a ref at sendOtp time; reading it during render
    // is a deliberate quality-of-life return (the previous implementation did
    // the same — see the pre-Phase-4 baseline). It is updated synchronously
    // before the mutation resolves, so the reading screen sees the latest
    // email by the time it re-renders after a successful submit.
    // eslint-disable-next-line react-hooks/refs
    email: emailRef.current,
    resetSendOtp: sendOtpMutation.reset,
    resetVerify: verifyOtpMutation.reset,
  };
}
