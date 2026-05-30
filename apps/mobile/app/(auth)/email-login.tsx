import React, { useState } from "react";
import {
  View,
  Image,
  ActivityIndicator,
  Keyboard,
  TouchableWithoutFeedback,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { Email } from "@/types/Auth";
import { useAuth } from "@/contexts/AuthContext";
import { useLoginMutation } from "@/hooks/useLoginMutation";
import { usePasskey } from "@/hooks/usePasskey";
import { useResendTimer } from "@/hooks/useResendTimer";
import { WithScreenTheme } from "@/components/WithScreenTheme";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { ThemedTextInput } from "@/components/ui/molecules";
import { ScreenVerificationCodeInput } from "@/components/ui/organisms/ScreenVerificationCodeInput";
import { PasskeySetupModal } from "@/components/ui/organisms/modals/PasskeySetupModal";
import { useToast } from "@/contexts/ToastContext";

function EmailLoginScreen() {
  const [emailInput, setEmailInput] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [showPasskeySetup, setShowPasskeySetup] = useState(false);
  const { completeLogin, completePasskeySetup, user } = useAuth();
  const { showToast } = useToast();
  const {
    checkPasskeys,
    registerPasskey,
    isRegistering,
    error: passkeyError,
    clearError: clearPasskeyError,
  } = usePasskey();

  const {
    sendOtpAsync,
    verifyOtpAsync,
    isSendingOtp,
    isVerifying,
    otpSent,
    resetSendOtp,
  } = useLoginMutation();

  const handleSendOtp = async () => {
    setEmailError(null);

    const result = Email.safeParse(emailInput.trim());
    if (!result.success) {
      setEmailError("Please enter a valid email address");
      return;
    }

    try {
      await sendOtpAsync(emailInput.trim());
    } catch (error: any) {
      showToast(error?.message || "Failed to send code. Please try again.");
    }
  };

  const handleVerifyOtp = async (code: string) => {
    setVerifyError(null);
    try {
      const result = await verifyOtpAsync(code);
      await completeLogin(result.data, emailInput.trim(), result.token);

      // Passkey check — mandatory before proceeding to dashboard.
      // Phase 5: under Privy, smart_account_address is the embedded
      // Solana wallet address; the legacy `result.data?.address` is gone.
      const accountAddress = result.data?.smart_account_address;
      if (accountAddress) {
        const hasExisting = await checkPasskeys(accountAddress);
        if (hasExisting) {
          completePasskeySetup();
        } else {
          setShowPasskeySetup(true);
        }
      } else {
        setShowPasskeySetup(true);
      }
    } catch {
      setVerifyError("Invalid code. Please try again.");
    }
  };

  const handleAddPasskey = async () => {
    clearPasskeyError();
    const addr = user?.smart_account_address || user?.address;
    if (!addr) return;

    const success = await registerPasskey(addr);
    if (success) {
      setShowPasskeySetup(false);
      completePasskeySetup();
    }
  };

  const handleSkipPasskey = () => {
    clearPasskeyError();
    setShowPasskeySetup(false);
    completePasskeySetup();
  };

  const handleResend = async () => {
    resetSendOtp();
    try {
      await sendOtpAsync(emailInput.trim());
    } catch {
      showToast("Failed to resend code.");
    }
  };

  const {
    countdown,
    isDisabled,
    handleResend: resend,
  } = useResendTimer({
    initialSeconds: 30,
    onResend: handleResend,
  });

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View className="flex-1">
        <GradientBackground />

        <ScrollView
          className="flex-1"
          contentContainerClassName="flex-grow"
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          <View className="flex-1 px-8 py-16">
            {/* Back button */}
            <HapticPressable
              onPress={() => router.back()}
              className="mt-8 self-start"
            >
              <Typography weight="500" className="text-lg text-white">
                {"< Back"}
              </Typography>
            </HapticPressable>

            <View className="flex-1 justify-end">
              {!otpSent ? (
                // State 1: Email input
                <View>
                  <Typography weight="600" className="mb-8 text-3xl text-white">
                    Enter your email
                  </Typography>

                  <KeyboardAvoidingView
                    behavior={Platform.OS === "ios" ? "padding" : undefined}
                    style={{ flex: 1 }}
                  >
                    <ThemedTextInput
                      value={emailInput}
                      onChangeText={(text) => {
                        setEmailInput(text);
                        setEmailError(null);
                      }}
                      placeholder="you@example.com"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="email"
                      error={!!emailError}
                      onSubmitEditing={handleSendOtp}
                      returnKeyType="go"
                      editable={!isSendingOtp}
                    />
                  </KeyboardAvoidingView>

                  {emailError && (
                    <Typography
                      weight="400"
                      className="mt-2 text-sm text-red-400"
                    >
                      {emailError}
                    </Typography>
                  )}

                  <HapticPressable
                    onPress={handleSendOtp}
                    disabled={isSendingOtp || !emailInput.trim()}
                    className="mt-6 items-center justify-center rounded-full bg-white p-4"
                    style={{
                      opacity: isSendingOtp || !emailInput.trim() ? 0.5 : 1,
                    }}
                  >
                    {isSendingOtp ? (
                      <ActivityIndicator color="#000" />
                    ) : (
                      <Typography weight="600" className="text-lg text-black">
                        Continue
                      </Typography>
                    )}
                  </HapticPressable>
                </View>
              ) : (
                // State 2: OTP input
                <View>
                  <Typography weight="600" className="mb-2 text-3xl text-white">
                    Enter the code
                  </Typography>
                  <Typography
                    weight="400"
                    className="mb-8 text-base text-[#8FE5F6]"
                  >
                    Sent to {emailInput.trim()}
                  </Typography>

                  <ScreenVerificationCodeInput
                    onCodeComplete={handleVerifyOtp}
                  />

                  {verifyError && (
                    <Typography
                      weight="400"
                      className="mt-2 text-sm text-red-400"
                    >
                      {verifyError}
                    </Typography>
                  )}

                  {isVerifying && (
                    <ActivityIndicator color="#fff" className="mt-4" />
                  )}

                  <HapticPressable
                    onPress={resend}
                    disabled={isDisabled}
                    className="mt-6 items-center"
                  >
                    <Typography
                      weight="500"
                      className="text-base text-white"
                      style={{ opacity: isDisabled ? 0.5 : 1 }}
                    >
                      {countdown
                        ? `Resend code in ${countdown}s`
                        : "Resend code"}
                    </Typography>
                  </HapticPressable>
                </View>
              )}
            </View>
          </View>
        </ScrollView>

        <PasskeySetupModal
          visible={showPasskeySetup}
          onAddPasskey={handleAddPasskey}
          isLoading={isRegistering}
          error={passkeyError}
          onRetry={handleAddPasskey}
          onSkip={handleSkipPasskey}
        />
      </View>
    </TouchableWithoutFeedback>
  );
}

const GradientBackground = () => {
  return (
    <>
      <Image
        source={require("@/assets/images/onboarding/blue-blur-1.png")}
        className="absolute bottom-[58px] left-0 h-[468px] w-full"
        resizeMode="stretch"
      />
      <Image
        source={require("@/assets/images/onboarding/blue-blur-2.png")}
        className="absolute bottom-[-17px] left-0 h-[468px] w-full"
        resizeMode="cover"
      />
      <Image
        source={require("@/assets/images/onboarding/blue-blur-3.png")}
        className="absolute bottom-[-134px] left-0 h-[468px] w-full"
        resizeMode="cover"
      />
    </>
  );
};

export default WithScreenTheme(EmailLoginScreen, {
  backgroundColor: "#000000",
  textColor: "#FFFFFF",
  primaryColor: "#FFFFFF",
});
