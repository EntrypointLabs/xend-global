import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  useEmbeddedSolanaWallet,
  useIdentityToken,
  useLoginWithEmail,
  usePrivy,
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
  const { logout, user: privyUser } = usePrivy();
  const embeddedSolana = useEmbeddedSolanaWallet();

  const sendOtpMutation = useMutation({
    mutationFn: async (email: string) => {
      emailRef.current = email;
      // A prior login whose exchange never completed leaves Privy logged in
      // while the app is not; clear it so loginWithCode issues a fresh session.
      if (privyUser) {
        await logout();
      }
      await sendCode({ email });
      setIsNewUser(false);
      return { data: { email } };
    },
  });

  const verifyOtpMutation = useMutation({
    mutationFn: async (otpCode: string) => {
      const privyLoginUser = await loginWithCode({ code: otpCode });
      if (!privyLoginUser) {
        throw new Error("Privy loginWithCode returned no user");
      }
      // Read passkey status off the user Privy just returned — the reactive
      // `usePrivy().user` hasn't re-rendered yet, so a stale closure would
      // wrongly report "no passkey" and re-prompt returning users.
      const hasPasskey =
        privyLoginUser.linked_accounts?.some(
          (account) => account.type === "passkey"
        ) ?? false;
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
        smart_account_address: exchange.user.walletAddress,
        privyWalletAddress: embeddedSolana.wallets?.[0]?.address ?? null,
      };
      return { data, token: exchange.token, hasPasskey };
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
