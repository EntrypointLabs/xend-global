import React, { useRef, useState } from "react";
import { View } from "react-native";
import { ThemedScreen } from "@/components/ui/layout";
import { ThemedText, IconSymbol, LoadingSpinner } from "@/components/ui/atoms";
// TODO: check if this is needed
import { IconSymbolName } from "@/components/ui/atoms/IconSymbol";
import { router, useLocalSearchParams } from "expo-router";
import { formatAmount } from "@/utils/helper";
import { useThemeColor } from "@/hooks/useThemeColor";
import { ButtonGroup } from "@/components/ui/molecules";
import { useAuth } from "@/contexts/AuthContext";
import { ErrorCode } from "@/utils/errors";
import { useToast } from "@/contexts/ToastContext";
import * as Sentry from "@sentry/react-native";
import { StorageService } from "@/utils/storage";
import { AUTH_STORAGE_KEYS } from "@/utils/auth";
import { useSendTransactionMutation } from "@/queries/useSendTransactionMutation";

export default function ConfirmScreen() {
  const textColor = useThemeColor({}, "text");
  const [isLoading, setIsLoading] = useState(false);
  const { user, logout } = useAuth();
  const { showToast } = useToast();
  const mutation = useSendTransactionMutation();
  // Synchronous in-flight guard — React state updates are async-batched, so a
  // rapid double-tap on Confirm can fire two requests between setIsLoading(true)
  // and the disabled-button re-render. useRef.current changes immediately.
  const inFlight = useRef(false);

  const { amount, recipient, name, type, title } = useLocalSearchParams<{
    amount: string;
    recipient: string;
    name: string;
    type: string;
    title: string;
  }>();

  const handleConfirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsLoading(true);
    try {
      const sessionSecrets = await StorageService.getItem(
        AUTH_STORAGE_KEYS.SESSION_SECRETS,
      );
      if (
        !user ||
        !user.address ||
        !user.authentication ||
        !sessionSecrets
      ) {
        logout();
        router.push({ pathname: "/(auth)/login" });
        return;
      }

      // Single round-trip: backend handles prepare + sign + send via Grid.
      // amount is a DECIMAL string ("0.10"); backend's TOKEN_DECIMALS maps it
      // to base units before calling createPaymentIntent.
      await mutation.mutateAsync({
        toAddress: recipient,
        amount,
        token: "USDC",
        sessionSecrets: sessionSecrets as never,
        session: user.authentication,
      });

      router.push({
        pathname: "/success",
        params: { amount, type, title },
      });
    } catch (error: any) {
      if (
        error?.data?.code === ErrorCode.SESSION_EXPIRED ||
        error?.data?.details?.some(
          (detail: any) => detail.code === "API_KEY_EXPIRED",
        )
      ) {
        showToast("Session expired, please log in again");
        logout();
        return;
      }

      Sentry.captureException(
        new Error(
          `Failed to confirm payment: ${error}. (send)/confirm.tsx (handleConfirm)`,
        ),
      );
      showToast("Could not send. Try again.");
    } finally {
      setIsLoading(false);
      inFlight.current = false;
    }
  };

  const handleCancel = () => {
    // Navigate to home
    router.push({
      pathname: "/(tabs)",
      params: { amount, type, title },
    });
  };

  const renderInfo = (icon: IconSymbolName, label: string, value: string) => {
    const iconColor = textColor + "40";
    return (
      <View>
        <View className="mb-2 flex-row items-center gap-1">
          <IconSymbol name={icon} size={16} color={iconColor} />
          {/* DYNAMIC-COLOR */}
          <ThemedText type="regular" style={{ color: iconColor }}>
            {label}
          </ThemedText>
        </View>
        <ThemedText
          type="defaultSemiBold"
          className="text-[18px] leading-[23px]"
        >
          {value}
        </ThemedText>
      </View>
    );
  };

  return (
    <ThemedScreen
      useSafeArea={true}
      safeAreaEdges={["bottom", "left", "right"]}
    >
      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <View className="flex-1 px-6 pb-8 pt-12">
          <View className="flex-1 gap-6">
            <View className="gap-2">
              <ThemedText type="regular">Amount</ThemedText>
              <ThemedText type="jumbo">{formatAmount({ amount })}</ThemedText>
            </View>
            {renderInfo("arrow.forward", "To", recipient)}
            {renderInfo("person", "Name", name)}
            {/* {renderInfo('network', 'Network fee', '0.0004 SOL')} */}
          </View>

          <ButtonGroup
            leftTitle="Cancel"
            leftVariant="secondary"
            rightTitle="Confirm"
            rightVariant="primary"
            leftOnPress={handleCancel}
            rightOnPress={handleConfirm}
          />
        </View>
      )}
    </ThemedScreen>
  );
}
