import React, { useState } from "react";
import { View, TouchableOpacity, ActivityIndicator } from "react-native";
import * as Clipboard from "expo-clipboard";
import { router, Link } from "expo-router";
import { useModalFlow } from "@/contexts/ModalFlowContext";
import { WithScreenTheme } from "@/components/WithScreenTheme";
import { ThemedScreen, StarburstBank } from "@/components/ui/layout";
import {
  CurrencySwitcher,
  SwipeableModal,
  OverlappingImages,
} from "@/components/ui/organisms";
import { useToast } from "@/contexts/ToastContext";
import { useScreenTheme } from "@/contexts/ScreenThemeContext";
import { ThemedText, Chip, IconSymbol, Divider } from "@/components/ui/atoms";
import { IconSymbolName } from "@/components/ui/atoms/IconSymbol";
import { ThemedButton } from "@/components/ui/molecules";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/contexts/AuthContext";
import { Currency } from "@/types/Transaction";
import * as Sentry from "@sentry/react-native";

interface BankDetail {
  label: string;
  value: string;
  icon?: IconSymbolName;
}

const INFO = [
  {
    icon: "dollarsign.arrow.circlepath",
    textEUR:
      "Get paid in EUR and automatically receive EURC in your Xend wallet",
    textUSD:
      "Get paid in USD and automatically receive USDC in your Xend wallet",
  },
  {
    icon: "arrow.down.circle",
    textEUR:
      "Receive payments from anyone with a bank account for a 0.1% conversion fee",
    textUSD:
      "Receive payments from anyone with a bank account for a 0.1% conversion fee",
  },
  {
    icon: "checkmark.circle",
    textEUR: "Quick setup through Bridge with standard KYC verification",
    textUSD: "Quick setup through Bridge with standard KYC verification",
  },
];

interface InfoItem {
  icon: string;
  textEUR: string;
  textUSD: string;
}

function BankDetailsModal() {
  const {
    selectedCurrency,
    setSelectedCurrency,
    bankAccountDetails,
    isLoading,
    fetchBankDetails,
    error: contextError,
  } = useModalFlow();

  const [error, setError] = useState<string | null>(contextError);
  const { backgroundColor, textColor } = useScreenTheme();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const { user, logout } = useAuth();
  const { showToast } = useToast();
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);

  const handleCurrencyChange = (currency: Currency) => {
    if (!isCreatingAccount) {
      setSelectedCurrency(currency);
    }
  };

  const handleClose = () => {
    router.back();
  };

  const handleCopy = async (label: string, value: string) => {
    try {
      await Clipboard.setStringAsync(value);
      setCopiedField(label);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        setCopiedField(null);
      }, 2000);
    } catch (e) {
      setError("Failed to copy to clipboard");
      Sentry.captureException(
        new Error(
          `Failed to copy to clipboard: ${e}. (modals)/bankdetails.tsx (handleCopy, label: ${label})`
        )
      );
    }
  };

  const handleCopyAll = async () => {
    if (!bankAccountDetails) return;
    try {
      const details: BankDetail[] = [
        {
          label: "Bank Name",
          value: bankAccountDetails[0].source_deposit_instructions.bank_name,
        },
        {
          label: "Account Number",
          value:
            bankAccountDetails[0].source_deposit_instructions
              .bank_account_number,
        },
        {
          label: "Routing Number",
          value:
            bankAccountDetails[0].source_deposit_instructions
              .bank_routing_number,
        },
        {
          label: "Beneficiary Name",
          value:
            bankAccountDetails[0].source_deposit_instructions
              .bank_beneficiary_name,
        },
        {
          label: "Bank Address",
          value: bankAccountDetails[0].source_deposit_instructions.bank_address,
        },
      ];

      const allDetails = details
        .map((detail) => `${detail.label}: ${detail.value}`)
        .join("\n");
      await Clipboard.setStringAsync(allDetails);
      setCopiedField("all");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        setCopiedField(null);
      }, 2000);
    } catch (e) {
      setError("Failed to copy to clipboard");
      Sentry.captureException(
        new Error(
          `Failed to copy to clipboard: ${e}. (modals)/bankdetails.tsx (handleCopyAll)`
        )
      );
    }
  };

  // Virtual-account creation is not yet available; the button surfaces a
  // "coming soon" toast. The unused state setters below are kept referenced
  // so the surrounding bank-details rendering stays intact for when KYC wires
  // real account creation.
  const handleCreateBankAccount = async () => {
    if (!user) {
      logout();
      return;
    }
    void selectedCurrency;
    void fetchBankDetails;
    void setError;
    void setIsCreatingAccount;
    showToast(
      "Virtual bank accounts are coming soon. Talk to us if you need this today."
    );
    Sentry.captureMessage(
      "bankdetails.handleCreateBankAccount invoked post-Phase-5 stub"
    );
  };

  const renderChipContent = (content: React.ReactNode) => {
    return (
      <Chip>
        <View className="flex-row items-center justify-center">{content}</View>
      </Chip>
    );
  };

  const renderChips = () => {
    return (
      <View className="mt-4 flex-row gap-1">
        {renderChipContent(
          <>
            {/* DYNAMIC-COLOR */}
            <ThemedText type="regular" style={{ color: textColor + 40 }}>
              Fees{" "}
            </ThemedText>
            <ThemedText type="regular">0.1%</ThemedText>
          </>
        )}
        {renderChipContent(
          <>
            <ThemedText type="regular">Limits </ThemedText>
            <IconSymbol name="arrow.up.right" size={10} color={textColor} />
          </>
        )}
        {renderChipContent(
          // DYNAMIC-COLOR
          <ThemedText type="regular" style={{ color: textColor + 40 }}>
            Min. transfer is {selectedCurrency === "usd" ? "$2" : "€2"}
          </ThemedText>
        )}
      </View>
    );
  };

  const renderInfo = (detail: BankDetail) => {
    const isCopied = copiedField === detail.label;

    return (
      <View key={detail.label} className="w-full">
        {/* DYNAMIC-COLOR */}
        <ThemedText type="regular" style={{ color: textColor + 40 }}>
          {detail.label}
        </ThemedText>
        <View className="mb-4 flex-row items-start justify-between">
          {/* DYNAMIC-COLOR */}
          <ThemedText
            type="regular"
            style={{ color: textColor }}
            numberOfLines={0}
          >
            {detail.value}
          </ThemedText>
          <TouchableOpacity
            onPress={() => handleCopy(detail.label, detail.value)}
            className="p-0.5"
          >
            <IconSymbol
              name={isCopied ? "checkmark" : "doc.on.doc"}
              size={20}
              color={textColor + 40}
            />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderCreateAccountInfo = (detail: InfoItem, isLast: boolean) => {
    return (
      <View key={detail.icon} className="w-full">
        <View className="mb-4 flex-row items-start justify-between">
          {/* DYNAMIC-COLOR */}
          <View
            className="rounded-[10px] p-[7px]"
            style={{ backgroundColor: textColor + 40 }}
          >
            <IconSymbol
              name={detail.icon as IconSymbolName}
              size={20}
              color={textColor}
            />
          </View>
          <View className="flex-1">
            {/* DYNAMIC-COLOR */}
            <ThemedText
              type="regular"
              className="ml-2"
              style={{ color: textColor + 40 }}
              numberOfLines={0}
            >
              {selectedCurrency === "eur" ? detail.textEUR : detail.textUSD}
            </ThemedText>
            {!isLast && (
              <Divider type="solid" color={textColor + 10} thickness={1} />
            )}
          </View>
        </View>
      </View>
    );
  };

  const renderContent = () => {
    if (isLoading || isCreatingAccount) {
      return (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
          {/* DYNAMIC-COLOR */}
          <ThemedText
            type="regular"
            className="mt-4"
            style={{ color: textColor + 40 }}
          >
            {isCreatingAccount
              ? "Creating your virtual account..."
              : "Loading..."}
          </ThemedText>
        </View>
      );
    }

    if (
      bankAccountDetails?.length &&
      bankAccountDetails?.length >= 1 &&
      selectedCurrency === "usd" &&
      bankAccountDetails[0].source_deposit_instructions.currency === "usd"
    ) {
      const bankDetails: BankDetail[] = [
        {
          label: "Bank Name",
          value: bankAccountDetails[0].source_deposit_instructions.bank_name,
        },
        {
          label: "Account Number",
          value:
            bankAccountDetails[0].source_deposit_instructions
              .bank_account_number,
        },
        {
          label: "Routing Number",
          value:
            bankAccountDetails[0].source_deposit_instructions
              .bank_routing_number,
        },
        {
          label: "Beneficiary Name",
          value:
            bankAccountDetails[0].source_deposit_instructions
              .bank_beneficiary_name,
        },
        {
          label: "Bank Address",
          value: bankAccountDetails[0].source_deposit_instructions.bank_address,
        },
      ];

      return (
        <>
          <View className="mx-4 mt-8 flex-1 items-center">
            <ThemedText type="subtitle">Virtual US Bank Account</ThemedText>
            {/* DYNAMIC-COLOR */}
            <ThemedText type="regular" style={{ color: textColor + 40 }}>
              Accept ACH & Wire Payments
            </ThemedText>
            {renderChips()}
            <Divider type="dashed" color={textColor + 10} thickness={1} />
            {bankDetails.map((detail) => renderInfo(detail))}
          </View>
          {/* DYNAMIC-COLOR */}
          <ThemedText
            type="tiny"
            className="mb-8 w-4/5 self-center text-center"
            style={{ color: textColor + 40 }}
          >
            For assistance regarding issues with transfers and deposits, reach
            out to{" "}
            <Link href="mailto:support@bridge.xyz">support@bridge.xyz</Link>
          </ThemedText>
          <ThemedButton
            onPress={handleCopyAll}
            title={copiedField === "all" ? "Copied!" : "Copy all details"}
            variant={copiedField === "all" ? "outline" : "primary"}
          />
        </>
      );
    } else if (
      bankAccountDetails?.length === 1 &&
      selectedCurrency === "eur" &&
      bankAccountDetails[0].source_deposit_instructions.currency === "eur"
    ) {
      const bankDetails: BankDetail[] = [
        {
          label: "Bank Name",
          value: bankAccountDetails[0].source_deposit_instructions.bank_name,
        },
        {
          label: "Account Number",
          value:
            bankAccountDetails[0].source_deposit_instructions
              .bank_account_number,
        },
        {
          label: "Beneficiary Name",
          value:
            bankAccountDetails[0].source_deposit_instructions
              .bank_beneficiary_name,
        },
        {
          label: "Bank Address",
          value: bankAccountDetails[0].source_deposit_instructions.bank_address,
        },
      ];

      return (
        <>
          <View className="mx-4 mt-8 flex-1 items-center">
            <ThemedText type="subtitle">Virtual EUR Bank Account</ThemedText>
            {/* DYNAMIC-COLOR */}
            <ThemedText type="regular" style={{ color: textColor + 40 }}>
              Accept ACH & Wire Payments
            </ThemedText>
            {renderChips()}
            <Divider type="dashed" color={textColor + 10} thickness={1} />
            {bankDetails.map((detail) => renderInfo(detail))}
          </View>
          {/* DYNAMIC-COLOR */}
          <ThemedText
            type="tiny"
            className="mb-8 w-4/5 self-center text-center"
            style={{ color: textColor + 40 }}
          >
            For assistance regarding issues with transfers and deposits, reach
            out to{" "}
            <Link href="mailto:support@bridge.xyz">support@bridge.xyz</Link>
          </ThemedText>
          <ThemedButton
            onPress={handleCopyAll}
            title={copiedField === "all" ? "Copied!" : "Copy all details"}
            variant={copiedField === "all" ? "outline" : "primary"}
          />
        </>
      );
    } else {
      return (
        <>
          <View className="mt-12 items-center">
            <OverlappingImages
              leftImage={require("@/assets/images/us-flag-round.png")}
              rightImage={require("@/assets/images/eu-flag-round.png")}
              size={64}
              overlap={0.3}
              borderWidth={0}
              leftOnTop={selectedCurrency === "usd"}
              backdropOpacity={0.4}
            />
          </View>
          <View className="mx-4 mt-8 flex-1 items-center">
            <ThemedText type="large" className="text-center">
              Create your
            </ThemedText>
            <ThemedText type="large" className="text-center">
              Virtual {selectedCurrency === "usd" ? "US" : "EUR"} Bank Account
            </ThemedText>
            <View className="mt-12 w-full">
              {INFO.map((detail, index) =>
                renderCreateAccountInfo(detail, index === INFO.length - 1)
              )}
            </View>
          </View>
          <ThemedButton
            onPress={handleCreateBankAccount}
            title={`Create Virtual ${selectedCurrency === "usd" ? "US" : "EUR"} Account`}
            disabled={isCreatingAccount}
          />
        </>
      );
    }
  };

  return (
    <ThemedScreen>
      <SwipeableModal onDismiss={handleClose}>
        <StarburstBank primaryColor={error ? "#FF0048" : "#0080FF"} />
        <View className="h-4" />
        <CurrencySwitcher
          onCurrencyChange={handleCurrencyChange}
          backgroundColor={textColor}
          textColor={backgroundColor}
        />
        {renderContent()}
      </SwipeableModal>
    </ThemedScreen>
  );
}

export default WithScreenTheme(BankDetailsModal, {
  backgroundColor: "#000000",
  textColor: "#FFFFFF",
  primaryColor: "#FFFFFF",
});
