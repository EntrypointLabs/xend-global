import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/utils/apiClient";
import { SDKGridClient } from "@/grid/sdkClient";

export function useLoginMutation() {
  const [isNewUser, setIsNewUser] = useState(false);
  const userContextRef = useRef<any>(null);
  const emailRef = useRef<string>("");

  const sendOtpMutation = useMutation({
    mutationFn: async (email: string) => {
      emailRef.current = email;
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
    email: emailRef.current,
    resetSendOtp: sendOtpMutation.reset,
    resetVerify: verifyOtpMutation.reset,
  };
}
