import React, { useState } from "react";
import {
  Image,
  View,
  SectionList,
  TouchableOpacity,
  Linking,
} from "react-native";
import Constants from "expo-constants";
import { Typography } from "@/components/ui/atoms/Typography";
import {
  groupedRowClass,
  PhotoScreen,
  surfaceFor,
} from "@/components/ui/glass";
import { useColorfulTheme } from "@/contexts/AppearanceContext";
import { cn } from "@/utils/cn";
import { SettingsItem } from "@/components/ui/molecules";
import { Ionicons } from "@expo/vector-icons";
import { Spacing } from "@/constants/Spacing";
import { useAuth } from "@/contexts/AuthContext";
import TabHeaderText from "@/components/ui/atoms/TabHeaderText";
import { EditWalletModal } from "@/components/ui/organisms/modals/EditWalletModal";
import { NotificationsModal } from "@/components/ui/organisms/modals/NotificationsModal";
import { DeleteAccountModal } from "@/components/ui/organisms/modals/DeleteAccountModal";
import { useWalletName } from "@/hooks/useWalletName";
import { useBalances } from "@/hooks/useBalances";
import { useRouter } from "expo-router";
import { useToast } from "@/contexts/ToastContext";
import { useNotificationPreference } from "@/hooks/usePushRegistration";

const PRYDD_TWITTER_URL = "https://x.com/pryddfinance";
const PRIVACY_POLICY_URL = "https://www.prydd.co/legal/privacy-policy";
const TERMS_URL = "https://www.prydd.co/legal/terms-of-service";

const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";
const APP_BUILD =
  Constants.expoConfig?.ios?.buildNumber ??
  Constants.expoConfig?.android?.versionCode?.toString();

interface SettingsRow {
  label: string;
  icon: React.ComponentProps<typeof SettingsItem>["icon"];
  onPress: () => void;
  color?: string;
  tintOnPhoto?: boolean;
}

export default function SettingsScreen() {
  const router = useRouter();
  // This screen sits above the photo context PhotoScreen creates, so it
  // reads the theme directly.
  const colorful = useColorfulTheme();
  const S = surfaceFor(colorful);
  const { logout, user } = useAuth();
  const { name: walletName, setName: setWalletName } = useWalletName();
  const [showEditWallet, setShowEditWallet] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notifications = useNotificationPreference();
  const { showToast } = useToast();
  const { total: balanceTotal, totalDisplay: balanceDisplay } = useBalances();

  const accountAddress = user?.smart_account_address || user?.address;

  const handleAccountDeleted = async () => {
    showToast("Your account has been deleted");
    await logout();
  };

  // The photo's brighter red only on the photo; the stock red on white.
  const deleteRed = colorful ? "#FF7A70" : "#F90101";

  const sections: { title: string; data: SettingsRow[] }[] = [
    {
      title: "Security",
      data: [
        {
          // One row, not two: the Passkey is one of the keys this screen is
          // about, and a separate shortcut would be a second place to set it up
          // that could disagree with the first.
          label: "Keys & Recovery",
          icon: require("@/assets/icons/keys.png"),
          onPress: () => router.push("/settings/keys-and-recovery" as never),
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
          label: "Edit Account",
          icon: require("@/assets/icons/edit-wallet.png"),
          tintOnPhoto: true,
          onPress: () => setShowEditWallet(true),
        },
        {
          label: "Appearance",
          icon: <Ionicons name="color-palette" size={24} color="#FF8A1F" />,
          onPress: () => router.push("/settings/appearance" as never),
        },
        {
          label: "Notifications",
          icon: require("@/assets/icons/notification.png"),
          onPress: () => setNotificationsOpen(true),
        },
        {
          label: "Address book",
          icon: require("@/assets/icons/address-book.png"),
          onPress: () => router.push("/settings/address-book" as never),
        },
        {
          label: "Prydd Card",
          icon: require("@/assets/icons/card.png"),
          onPress: () => router.push("/card?from=/(tabs)/settings" as never),
        },
      ],
    },
    {
      title: "About",
      data: [
        {
          label: "Contact support",
          icon: require("@/assets/icons/support.png"),
          onPress: () => router.push("/settings/support" as never),
        },
        {
          label: "Share your feedback",
          icon: require("@/assets/icons/feedback.png"),
          onPress: () => router.push("/settings/feedback" as never),
        },
        {
          label: "Follow @pryddfinance",
          icon: require("@/assets/icons/x.png"),
          onPress: () => {
            Linking.openURL(PRYDD_TWITTER_URL);
          },
        },
        {
          label: "Logout",
          icon: (
            <Ionicons name="log-out-outline" size={22} color={S.colors.ink} />
          ),
          onPress: logout,
        },
        {
          label: "Delete Account",
          // The photo's brighter destructive red; the stock #F90101 is too dark
          // to read on the veil.
          icon: (
            <Ionicons
              name="person-remove-outline"
              size={22}
              color={deleteRed}
            />
          ),
          onPress: () => setShowDeleteAccount(true),
          color: deleteRed,
        },
      ],
    },
  ];

  return (
    <PhotoScreen scene="shore" blurred>
      <View className="w-full flex-1">
        <SectionList
          ListHeaderComponent={
            <View>
              <TabHeaderText>Settings</TabHeaderText>

              {/* Prydd Plus Banner */}
              <TouchableOpacity
                className={cn(
                  "flex-row items-center justify-between p-4",
                  colorful
                    ? "rounded-[16px] border border-white/[0.18] bg-black/60"
                    : "rounded-3xl bg-black"
                )}
                activeOpacity={0.9}
                accessibilityRole="button"
                accessibilityLabel="Learn about Prydd Plus"
                onPress={() =>
                  router.push("/plus?from=/(tabs)/settings" as never)
                }
              >
                <View className="flex-row items-center">
                  <View className="mr-3 h-8 w-8 items-center justify-center">
                    <Ionicons name="sparkles" size={20} color="white" />
                  </View>
                  <View>
                    <Typography weight="700" className="text-sm text-white">
                      Get Prydd Plus
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
          renderItem={({ item, index, section }) => {
            const row = (
              <SettingsItem
                label={item.label}
                icon={item.icon}
                onPress={item.onPress}
                color={item.color}
                tintOnPhoto={item.tintOnPhoto}
              />
            );
            if (!colorful) return row;
            return (
              <View
                className={cn(
                  groupedRowClass(index, section.data.length),
                  index > 0 && "border-t border-t-white/[0.12]"
                )}
              >
                {row}
              </View>
            );
          }}
          renderSectionHeader={({ section: { title } }) => (
            <View className="mb-2 mt-6">
              <Typography weight="500" className={cn("text-lg", S.caption)}>
                {title}
              </Typography>
            </View>
          )}
          ListFooterComponent={
            <View className="mt-8 items-center">
              <Image
                source={
                  colorful
                    ? require("@/assets/images/logo/prydd-mark-white-2048.png")
                    : require("@/assets/images/logo/prydd-mark-black-2048.png")
                }
                className={cn(
                  "mb-3 size-8",
                  colorful ? "opacity-60" : "opacity-40"
                )}
                resizeMode="contain"
              />
              <Typography weight="500" className={cn("text-sm", S.small)}>
                Version {APP_VERSION}
                {APP_BUILD ? ` (${APP_BUILD})` : ""}
              </Typography>
              <View className="mt-3 flex-row items-center">
                <TouchableOpacity
                  onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
                >
                  <Typography weight="500" className={cn("text-xs", S.small)}>
                    Privacy Policy
                  </Typography>
                </TouchableOpacity>
                <Typography
                  weight="500"
                  className={cn("mx-2 text-xs", S.small)}
                >
                  ·
                </Typography>
                <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL)}>
                  <Typography weight="500" className={cn("text-xs", S.small)}>
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
      <NotificationsModal
        visible={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        initialEnabled={notifications.enabled ?? true}
        onToggle={notifications.setEnabled}
      />
    </PhotoScreen>
  );
}
