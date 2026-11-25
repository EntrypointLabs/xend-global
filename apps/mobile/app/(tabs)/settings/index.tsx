import React, { useState } from "react";
import {
  Image,
  View,
  SectionList,
  TouchableOpacity,
  Linking,
} from "react-native";
import * as Application from "expo-application";
import Constants from "expo-constants";
import { Typography } from "@/components/ui/atoms/Typography";
import {
  groupedRowClass,
  PhotoScreen,
  useSurfaceFor,
} from "@/components/ui/glass";
import { useColorfulTheme } from "@/contexts/AppearanceContext";
import { cn } from "@/utils/cn";
import { SettingsItem } from "@/components/ui/molecules";
import { FontAwesome6, Ionicons } from "@expo/vector-icons";
import { Spacing } from "@/constants/Spacing";
import { useAuth } from "@/contexts/AuthContext";
import TabHeaderText from "@/components/ui/atoms/TabHeaderText";
import { EditWalletModal } from "@/components/ui/organisms/modals/EditWalletModal";
import { NotificationsModal } from "@/components/ui/organisms/modals/NotificationsModal";
import { DeleteAccountModal } from "@/components/ui/organisms/modals/DeleteAccountModal";
import { ACCOUNT_NAME_MAX_LENGTH, useWalletName } from "@/hooks/useWalletName";
import { useCollapseOnScroll } from "@/hooks/useTabBarCollapse";
import { useBalances } from "@/hooks/useBalances";
import { useEarnPosition } from "@/hooks/useEarn";
import { formatMoney, holdingsBeforeDelete } from "@/utils/balances";
import { useRouter } from "expo-router";
import { useToast } from "@/contexts/ToastContext";
import { useNotificationPreference } from "@/hooks/usePushRegistration";
import { usePalette } from "@/hooks/usePalette";

const PRYDD_TWITTER_URL = "https://x.com/pryddfinance";
const PRIVACY_POLICY_URL = "https://www.prydd.co/legal/privacy-policy";
const TERMS_URL = "https://www.prydd.co/legal/terms-of-service";

// Read from the installed binary. EAS assigns the build number at build time,
// so it never appears in the app config.
const APP_VERSION =
  Application.nativeApplicationVersion ??
  Constants.expoConfig?.version ??
  "1.0.0";
const APP_BUILD = Application.nativeBuildVersion;

const MARKS = {
  editAccount: [
    require("@/assets/icons/marks/edit-account-ink.webp"),
    require("@/assets/icons/marks/edit-account-paper.webp"),
  ],
  logout: [
    require("@/assets/icons/marks/logout-ink.webp"),
    require("@/assets/icons/marks/logout-paper.webp"),
  ],
  deleteAccount: [
    require("@/assets/icons/marks/delete-account-ink.webp"),
    require("@/assets/icons/marks/delete-account-paper.webp"),
  ],
} as const;

interface SettingsRow {
  label: string;
  icon: React.ComponentProps<typeof SettingsItem>["icon"];
  onPress: () => void;
  color?: string;
}

export default function SettingsScreen() {
  const collapseOnScroll = useCollapseOnScroll();
  const router = useRouter();
  // This screen sits above the photo context PhotoScreen creates, so it
  // reads the theme directly.
  const colorful = useColorfulTheme();
  const S = useSurfaceFor(colorful);
  const palette = usePalette();
  const { logout, user } = useAuth();
  const { name: walletName, setName: setWalletName } = useWalletName();
  const [showEditWallet, setShowEditWallet] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notifications = useNotificationPreference();
  const { showToast } = useToast();
  const { tokens } = useBalances();
  const { balance: earnBalance } = useEarnPosition();
  const held = holdingsBeforeDelete(tokens, earnBalance);

  const accountAddress = user?.smart_account_address || user?.address;

  const handleAccountDeleted = async () => {
    showToast("Your account has been deleted");
    await logout();
  };

  // The photo's brighter red only on the photo; the stock red off it.
  const deleteRed = colorful ? "#FF7A70" : palette.destructive;

  const onDark = colorful || palette.dark;
  const mark = (name: keyof typeof MARKS) => MARKS[name][onDark ? 1 : 0];
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
          label: "Quick pay",
          icon: require("@/assets/icons/quick-pay.png"),
          onPress: () => router.push("/settings/spending-limits" as never),
        },
        {
          label: "Connected Merchants",
          icon: require("@/assets/icons/merchants.png"),
          onPress: () => router.push("/settings/connected-merchants" as never),
        },
      ],
    },
    {
      title: "General",
      data: [
        {
          label: "Edit Account",
          icon: mark("editAccount"),
          onPress: () => setShowEditWallet(true),
        },
        {
          label: "Appearance",
          icon: require("@/assets/icons/appearance.png"),
          onPress: () => router.push("/settings/appearance" as never),
        },
        {
          label: "Notifications",
          icon: require("@/assets/icons/notification.png"),
          onPress: () => setNotificationsOpen(true),
        },
        {
          label: "Naira limits",
          icon: require("@/assets/icons/naira-limits.png"),
          onPress: () => router.push("/naira-limits" as never),
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
          icon: (
            <FontAwesome6 name="x-twitter" size={20} color={S.colors.ink} />
          ),
          onPress: () => {
            Linking.openURL(PRYDD_TWITTER_URL);
          },
        },
        {
          label: "Logout",
          icon: mark("logout"),
          onPress: logout,
        },
        {
          label: "Delete Account",
          // The photo's brighter destructive red; the stock one is too dark to
          // read on the veil.
          icon: colorful
            ? require("@/assets/icons/marks/delete-account-photo.webp")
            : mark("deleteAccount"),
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
          {...collapseOnScroll}
          ListHeaderComponent={
            <View>
              <TabHeaderText>Settings</TabHeaderText>

              {/* Prydd Plus Banner */}
              <TouchableOpacity
                className={cn(
                  "flex-row items-center justify-between p-4",
                  colorful
                    ? "rounded-[16px] border border-white/[0.18] bg-black/60"
                    : "rounded-3xl bg-black dark:bg-card"
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
                  colorful || palette.dark
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
        maxLength={ACCOUNT_NAME_MAX_LENGTH}
      />
      <DeleteAccountModal
        visible={showDeleteAccount}
        onClose={() => setShowDeleteAccount(false)}
        canDelete={!held.holdsAnything}
        heldDisplay={
          held.usd !== null && held.usd > 0 ? `$${formatMoney(held.usd)}` : null
        }
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
