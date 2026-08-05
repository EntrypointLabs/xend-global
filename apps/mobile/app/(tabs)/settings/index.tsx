import React, { useRef, useState } from "react";
import {
  Image,
  View,
  SectionList,
  TouchableOpacity,
  Linking,
} from "react-native";
import Constants from "expo-constants";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { Typography } from "@/components/ui/atoms/Typography";
import { ScreenLayout } from "@/components/ui/layout";
import { SettingsItem } from "@/components/ui/molecules";
import { Ionicons } from "@expo/vector-icons";
import { Spacing } from "@/constants/Spacing";
import { useAuth } from "@/contexts/AuthContext";
import TabHeaderText from "@/components/ui/atoms/TabHeaderText";
import { PasskeySetupModal } from "@/components/ui/organisms/modals/PasskeySetupModal";
import { EditWalletModal } from "@/components/ui/organisms/modals/EditWalletModal";
import { NotificationsSheet } from "@/components/ui/organisms/modals/NotificationsSheet";
import { DeleteAccountModal } from "@/components/ui/organisms/modals/DeleteAccountModal";
import { usePasskey } from "@/hooks/usePasskey";
import { useWalletName } from "@/hooks/useWalletName";
import { useBalances } from "@/hooks/useBalances";
import { useRouter } from "expo-router";
import { useToast } from "@/contexts/ToastContext";

const XEND_TWITTER_URL = "https://twitter.com/xend_global";
const PRIVACY_POLICY_URL = "https://xend.global/legal/privacy-policy";
const TERMS_URL = "https://xend.global/legal/terms-of-service";

const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";
const APP_BUILD =
  Constants.expoConfig?.ios?.buildNumber ??
  Constants.expoConfig?.android?.versionCode?.toString();

export default function SettingsScreen() {
  const router = useRouter();
  const { logout, user } = useAuth();
  const {
    hasPasskey,
    isRegistering,
    error: passkeyError,
    registerPasskey,
    clearError: clearPasskeyError,
  } = usePasskey();
  const [showPasskeyModal, setShowPasskeyModal] = useState(false);
  const { name: walletName, setName: setWalletName } = useWalletName();
  const [showEditWallet, setShowEditWallet] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const notificationsSheetRef = useRef<BottomSheetModal>(null);
  const { showToast } = useToast();
  const { total: balanceTotal, totalDisplay: balanceDisplay } = useBalances();

  const accountAddress = user?.smart_account_address || user?.address;

  const handleAccountDeleted = async () => {
    showToast("Your account has been deleted");
    await logout();
  };

  const handlePasskeyPress = () => {
    if (hasPasskey) {
      showToast("Passkey is already set up");
      return;
    }
    clearPasskeyError();
    setShowPasskeyModal(true);
  };

  const handleAddPasskey = async () => {
    clearPasskeyError();
    const success = await registerPasskey();
    if (success) {
      setShowPasskeyModal(false);
      showToast("Passkey set up successfully");
    }
  };

  const handleSkipPasskey = () => {
    clearPasskeyError();
    setShowPasskeyModal(false);
  };

  const sections = [
    {
      title: "Security",
      data: [
        {
          label: hasPasskey ? "Passkey (Enabled)" : "Set up Passkey",
          icon: require("@/assets/icons/keys.png"),
          onPress: handlePasskeyPress,
        },
        {
          label: "Keys & Recovery",
          icon: require("@/assets/icons/keys.png"),
          onPress: () => {},
        },
        {
          label: "Spending Limits",
          icon: require("@/assets/icons/spending-limt.png"),
          onPress: () => router.push("/settings/spending-limits" as never),
        },
        {
          label: "Connected Merchants",
          icon: require("@/assets/icons/card.png"),
          onPress: () => router.push("/settings/connected-merchants" as never),
        },
      ],
    },
    {
      title: "General",
      data: [
        {
          label: "Edit wallet",
          icon: require("@/assets/icons/edit-wallet.png"),
          onPress: () => setShowEditWallet(true),
        },
        {
          label: "Notifications",
          icon: require("@/assets/icons/notification.png"),
          onPress: () => notificationsSheetRef.current?.present(),
        },
        {
          label: "Address book",
          icon: require("@/assets/icons/address-book.png"),
          onPress: () => router.push("/settings/address-book" as never),
        },
        {
          label: "NFTs",
          icon: require("@/assets/icons/nfts.png"),
          onPress: () => {},
        },
      ],
    },
    {
      title: "About",
      data: [
        {
          label: "Contact support",
          icon: require("@/assets/icons/support.png"),
          onPress: () => {},
        },
        {
          label: "Share your feedback",
          icon: require("@/assets/icons/feedback.png"),
          onPress: () => {},
        },
        {
          label: "Follow @xend_global",
          icon: require("@/assets/icons/x.png"),
          onPress: () => {
            Linking.openURL(XEND_TWITTER_URL);
          },
        },
        {
          label: "Logout",
          icon: <Ionicons name="log-out-outline" size={22} color="#000000" />,
          onPress: logout,
        },
        {
          label: "Delete Account",
          icon: (
            <Ionicons name="person-remove-outline" size={22} color="#F90101" />
          ),
          onPress: () => setShowDeleteAccount(true),
          color: "#F90101",
        },
      ],
    },
  ];

  return (
    <ScreenLayout>
      <PasskeySetupModal
        visible={showPasskeyModal}
        onAddPasskey={handleAddPasskey}
        isLoading={isRegistering}
        error={passkeyError}
        onRetry={handleAddPasskey}
        onSkip={handleSkipPasskey}
        skipLabel="Cancel"
      />
      <View className="w-full flex-1">
        <SectionList
          ListHeaderComponent={
            <View>
              <TabHeaderText>Settings</TabHeaderText>

              {/* Xend Plus Banner */}
              <TouchableOpacity
                className="flex-row items-center justify-between rounded-3xl bg-black p-4"
                activeOpacity={0.9}
                accessibilityRole="button"
                accessibilityLabel="Learn about Xend Plus"
                onPress={() => router.push("/plus" as never)}
              >
                <View className="flex-row items-center">
                  <View className="mr-3 h-8 w-8 items-center justify-center">
                    <Ionicons name="sparkles" size={20} color="white" />
                  </View>
                  <View>
                    <Typography weight="700" className="text-sm text-white">
                      Get Xend Plus
                    </Typography>
                    <Typography className="text-xs text-gray-400">
                      Earn more, pay less
                    </Typography>
                  </View>
                </View>
                <View className="h-6 w-6 items-center justify-center rounded-full bg-white/20">
                  <Ionicons name="chevron-forward" size={14} color="white" />
                </View>
              </TouchableOpacity>
            </View>
          }
          sections={sections}
          keyExtractor={(item, index) => item.label + index}
          renderItem={({ item }) => (
            <SettingsItem
              label={item.label}
              icon={item.icon}
              onPress={item.onPress}
              color={item.color}
            />
          )}
          renderSectionHeader={({ section: { title } }) => (
            <View className="mb-2 mt-6">
              <Typography weight="500" className="text-lg text-black/40">
                {title}
              </Typography>
            </View>
          )}
          ListFooterComponent={
            <View className="mt-8 items-center">
              <Image
                source={require("@/assets/images/logo/xend-mark-black-2048.png")}
                className="mb-3 size-8 opacity-40"
                resizeMode="contain"
              />
              <Typography weight="500" className="text-sm text-black/40">
                Version {APP_VERSION}
                {APP_BUILD ? ` (${APP_BUILD})` : ""}
              </Typography>
              <View className="mt-3 flex-row items-center">
                <TouchableOpacity
                  onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
                >
                  <Typography weight="500" className="text-xs text-black/40">
                    Privacy Policy
                  </Typography>
                </TouchableOpacity>
                <Typography weight="500" className="mx-2 text-xs text-black/40">
                  ·
                </Typography>
                <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL)}>
                  <Typography weight="500" className="text-xs text-black/40">
                    Terms & Conditions
                  </Typography>
                </TouchableOpacity>
              </View>
            </View>
          }
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: Spacing.xxxl }}
          showsVerticalScrollIndicator={false}
        />
      </View>

      <EditWalletModal
        visible={showEditWallet}
        onClose={() => setShowEditWallet(false)}
        initialName={walletName}
        address={accountAddress ?? ""}
        onSave={setWalletName}
      />
      <DeleteAccountModal
        visible={showDeleteAccount}
        onClose={() => setShowDeleteAccount(false)}
        balance={balanceTotal}
        balanceDisplay={`$${balanceDisplay}`}
        onDeleted={handleAccountDeleted}
      />
      <NotificationsSheet ref={notificationsSheetRef} />
    </ScreenLayout>
  );
}
