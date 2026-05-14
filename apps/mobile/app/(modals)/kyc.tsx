import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  View,
  Keyboard,
} from "react-native";
import { router, useLocalSearchParams, Link } from "expo-router";
import { WithScreenTheme } from "@/components/WithScreenTheme";
import { ThemedScreen, StarburstBank } from "@/components/ui/layout";
import {
  SwipeableModal,
  OverlappingImages,
  InAppBrowser,
} from "@/components/ui/organisms";
import { useScreenTheme } from "@/contexts/ScreenThemeContext";
import { ThemedText } from "@/components/ui/atoms";
import { ThemedButton, ThemedTextInput } from "@/components/ui/molecules";
import { useAuth } from "@/contexts/AuthContext";
import { useKyc } from "@/hooks/useKyc";
import { KycParams } from "@/types/Kyc";
import * as Sentry from "@sentry/react-native";
import { cn } from "@/utils/cn";

function KYCModal() {
  const { textColor } = useScreenTheme();
  const { user, email } = useAuth();
  const { status, isLoading, startKyc, checkStatus, tosStatus } = useKyc();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [showNameInputs, setShowNameInputs] = useState(false);
  const [kycUrl, setKycUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [tosUrl, setTosUrl] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const params = useLocalSearchParams();
  const source = params.source;

  useEffect(() => {
    if (status === "approved" && tosStatus === "approved") {
      if (source === "receive") {
        router.replace("/bankdetails");
      } else {
        router.replace("/(send)/fiatamount");
      }
    }
  }, [status, tosStatus, source]);

  const handleClose = () => {
    router.back();
  };

  const handleInitialContinue = () => {
    setShowNameInputs(true);
  };

  const handleSubmit = async () => {
    Keyboard.dismiss();
    setIsSubmitting(true);
    setShowChecklist(true);

    if (!user || !email) {
      return;
    }

    try {
      const params: KycParams = {
        grid_user_id: user.grid_user_id!,
        smart_account_address: user.address!,
        email: email,
        full_name: `${firstName} ${lastName}`.trim(),
        redirect_uri: null,
      };

      const result = await startKyc(params);
      const { kycLink, tosLink } = result;
      setKycUrl(kycLink);
      setTosUrl(tosLink);
    } catch (err) {
      console.error("Error starting KYC:", err);
      Sentry.captureException(
        new Error(`Error starting KYC: ${err}. (modals)/kyc.tsx (handleSubmit)`)
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNavigationStateChange = async (navState: unknown) => {
    const url = (navState as { url?: string })?.url ?? "";
    // Check if we're on the completion or success page
    const isCompletionPage =
      url.includes("/completion") ||
      url.includes("/success") ||
      url.includes("status=complete");

    if (isCompletionPage) {
      await checkStatus(); // This will update the status in the hook
      handleClose();
    }
  };

  const renderContent = () => {
    return showChecklist ? (
      <View className="mx-8 flex-1 items-center justify-center gap-4">
        <ThemedButton
          title={
            tosStatus === "approved"
              ? `Terms of Service Accepted`
              : `Accept Terms of Service`
          }
          disabled={tosStatus === "approved"}
          onPress={() => setCurrentUrl(tosUrl)}
        />
        <ThemedButton
          title={status === "approved" ? `Kyc Completed` : `Complete Kyc`}
          disabled={status !== "not_started" && status !== "incomplete"}
          onPress={() => setCurrentUrl(kycUrl)}
        />
      </View>
    ) : (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
        keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}
      >
        <View className="mx-8 flex-1 items-center justify-center gap-4">
          {!showNameInputs && !showChecklist ? (
            <>
              <View className="mb-4 items-center">
                <OverlappingImages
                  leftImage={require("@/assets/images/bridge.png")}
                  rightImage={require("@/assets/images/starburst-round.png")}
                  size={64}
                  overlap={0.3}
                  borderWidth={0}
                />
              </View>
              <ThemedText type="large" className="px-6 text-center">
                Continue with Bridge for identity verification
              </ThemedText>
              {/* DYNAMIC-COLOR */}
              <ThemedText
                type="regular"
                className="mt-2 text-center"
                style={{ color: textColor + 40 }}
              >
                Complete verification with Bridge.xyz and your account details
                will automatically appear in your Bright App.
              </ThemedText>
            </>
          ) : (
            <View className="mt-4 w-full gap-2">
              {/* DYNAMIC-COLOR */}
              <ThemedTextInput
                value={firstName}
                onChangeText={setFirstName}
                placeholder="First Name"
                style={{ backgroundColor: textColor + 10 }}
                inputStyle={{ color: textColor }}
              />
              {/* DYNAMIC-COLOR */}
              <ThemedTextInput
                value={lastName}
                onChangeText={setLastName}
                placeholder="Last Name"
                style={{ backgroundColor: textColor + 10 }}
                inputStyle={{ color: textColor }}
              />
            </View>
          )}
        </View>
        <View
          className={cn("w-full px-8", Platform.OS === "ios" ? "pb-8" : "pb-4")}
        >
          {/* DYNAMIC-COLOR */}
          <ThemedText
            type="tiny"
            className="mb-8 w-4/5 self-center text-center"
            style={{ color: textColor + 40 }}
          >
            By pressing continue, you agree to the{" "}
            <Link href="https://bridge.xyz/terms-of-service">
              Terms and conditions
            </Link>
            .
          </ThemedText>
          <ThemedButton
            onPress={showNameInputs ? handleSubmit : handleInitialContinue}
            title={showNameInputs ? "Submit" : "Continue"}
            disabled={showNameInputs && (!firstName.trim() || !lastName.trim())}
          />
        </View>
      </KeyboardAvoidingView>
    );
  };

  return (
    <ThemedScreen>
      <SwipeableModal onDismiss={handleClose}>
        <StarburstBank primaryColor={"#0080FF"} />
        {isLoading || isSubmitting ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color={textColor} />
          </View>
        ) : (
          renderContent()
        )}
      </SwipeableModal>
      <InAppBrowser
        visible={!!currentUrl}
        onClose={() => {
          setCurrentUrl(null);
          checkStatus();
        }}
        url={currentUrl || ""}
        onNavigationStateChange={handleNavigationStateChange}
      />
    </ThemedScreen>
  );
}

export default WithScreenTheme(KYCModal, {
  backgroundColor: "#000000",
  textColor: "#FFFFFF",
  primaryColor: "#FFFFFF",
});
