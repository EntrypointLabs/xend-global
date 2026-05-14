import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { LoginForm } from "@/components/LoginForm";
import { Image, KeyboardAvoidingView, Platform, View } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import { WithScreenTheme } from "@/components/WithScreenTheme";
import { ThemedScreen } from "@/components/ui/layout";
import { useResendTimer } from "@/hooks/useResendTimer";
import { router } from "expo-router";
import { ErrorCode, handleError } from "@/utils/errors";

function RestoreAccountScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const [, setShowCodeInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, verifyCodeAndCreateAccount, user, setEmail } = useAuth();

  const triggerSignUp = async (emailToUse: string) => {
    setShowCodeInput(true);
    await register(emailToUse);
  };

  const handleResend = async () => {
    if (!user) {
      router.push("/(auth)/login");
      return;
    }
    await triggerSignUp(user.email!);
  };

  useResendTimer({
    initialSeconds: 30,
    onResend: handleResend,
  });

  const verify = async (code: string): Promise<boolean> => {
    const success = await verifyCodeAndCreateAccount(code);
    if (success) {
      router.replace("/success");
    }
    return success;
  };

  const handleSubmit = async (
    submittedEmail: string,
    code?: string,
    formError?: string
  ) => {
    try {
      setIsLoading(true);
      setError(null);
      setEmail(submittedEmail);

      if (formError) {
        setError(formError);
        handleError(ErrorCode.INVALID_EMAIL, true, true);
        return;
      }

      if (code) {
        const isValid = await verify(code);
        if (!isValid) {
          setError("Invalid code");
          return;
        }
        router.replace("/success");
      } else {
        await triggerSignUp(submittedEmail);
      }
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ThemedScreen>
      <Image
        source={require("@/assets/images/onboarding/purple-blur.png")}
        // MEASURED-LAYOUT
        style={{
          position: "absolute",
          width: "100%",
          height: 450,
          top: -100,
          left: 0,
        }}
        resizeMode="cover"
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}
        className="z-10 flex-1"
      >
        <View className="flex-1 justify-between px-10 py-16">
          <Typography
            weight="500"
            className="w-full max-w-[90px] text-xl text-white"
          >
            Secure your wallet
          </Typography>
          <View>
            <LoginForm
              onSubmit={handleSubmit}
              isLoading={isLoading}
              error={error}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </ThemedScreen>
  );
}

export default WithScreenTheme(RestoreAccountScreen, {
  backgroundColor: "#FFFFFF",
  textColor: "#000000",
  primaryColor: "#000000",
});
