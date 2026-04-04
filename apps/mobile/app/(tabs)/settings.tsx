import React from "react";
import { View, SectionList, TouchableOpacity } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import { ScreenLayout } from "@/components/ui/layout";
import { ThemedText } from "@/components/ui/atoms";
import { SettingsItem } from "@/components/ui/molecules";
import { Ionicons } from "@expo/vector-icons";
import { useThemeColor } from "@/hooks/useThemeColor";
import { Spacing } from "@/constants/Spacing";
import { useAuth } from "@/contexts/AuthContext";
import TabHeaderText from "@/components/ui/atoms/TabHeaderText";
import clsx from "clsx";

export default function SettingsScreen() {
  const { logout } = useAuth();
  const textColor = useThemeColor({}, "text");
  const backgroundColor = useThemeColor({}, "background");

  const sections = [
    {
      title: "Security",
      data: [
        {
          label: "Keys & Recovery",
          icon: require("@/assets/icons/keys.png"),
          onPress: () => {},
        },
        {
          label: "Spending Limits",
          icon: require("@/assets/icons/spending-limt.png"),
          onPress: () => {},
        },
      ],
    },
    {
      title: "General",
      data: [
        {
          label: "Edit wallet",
          icon: require("@/assets/icons/edit-wallet.png"),
          onPress: () => {},
        },
        {
          label: "Notifications",
          icon: require("@/assets/icons/notification.png"),
          onPress: () => {},
        },
        {
          label: "Address book",
          icon: require("@/assets/icons/address-book.png"),
          onPress: () => {},
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
          label: "Follow @fusewallet",
          // icon: <Ionicons name="logo-twitter" size={22} color="#007AFF" />, // Blue
          icon: require("@/assets/icons/x.png"),
          onPress: () => {},
        },
        {
          label: "Delete Wallet",
          icon: require("@/assets/icons/x.png"),
          onPress: logout,
          color: "#F90101",
        },
      ],
    },
  ];

  return (
    <ScreenLayout>
      <View className="w-full flex-1">
        <SectionList
          ListHeaderComponent={
            <View>
              <TabHeaderText>Settings</TabHeaderText>

              {/* Fuse Plus Banner */}
              <TouchableOpacity
                className="flex-row items-center justify-between rounded-3xl bg-black p-4"
                activeOpacity={0.9}
              >
                <View className="flex-row items-center">
                  <View className="mr-3 h-8 w-8 items-center justify-center">
                    <Ionicons name="sparkles" size={20} color="white" />
                  </View>
                  <View>
                    <Typography weight="700" className="text-sm text-white">
                      Get Fuse Plus
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
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: Spacing.xxxl }}
          showsVerticalScrollIndicator={false}
        />
      </View>
    </ScreenLayout>
  );
}
