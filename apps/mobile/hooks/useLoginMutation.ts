import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  useEmbeddedSolanaWallet,
  useIdentityToken,
  useLoginWithEmail,
} from "@privy-io/expo";

import { apiClient } from "@/utils/apiClient";

/**
 * Privy email-OTP login mutation hook.
 *
 * Returns:
 *   - `sendOtpAsync(email): Promise<{ data: { email } }>`
 *   - `verifyOtpAsync(code): Promise<{ data: any; token: string }>`
 *     where `data` carries `smart_account_address` for KYC screens that read
 *     that field.
 */
export function useLoginMutation() {
  const [isNewUser, setIsNewUser] = useState(false);
  const emailRef = useRef<string>("");

  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { getIdentityToken } = useIdentityToken();
  const embeddedSolana = useEmbeddedSolanaWallet();

  const sendOtpMutation = useMutation({
    mutationFn: async (email: string) => {
      emailRef.current = email;
      await sendCode({ email });
      // Privy collapses register and login into the same OTP flow; the
      // `isNewUser` distinction is settled by /auth/exchange when the OTP
      // is verified.
      setIsNewUser(false);
      return { data: { email } };
    },
  });

  const verifyOtpMutation = useMutation({
    mutationFn: async (otpCode: string) => {
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
        // The post-login passkey check reads smart_account_address.
        smart_account_address: exchange.user.walletAddress,
        privyWalletAddress: embeddedSolana.wallets?.[0]?.address ?? null,
      };
      return { data, token: exchange.token };
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
    email: emailRef.current,
    resetSendOtp: sendOtpMutation.reset,
    resetVerify: verifyOtpMutation.reset,
  };
}
