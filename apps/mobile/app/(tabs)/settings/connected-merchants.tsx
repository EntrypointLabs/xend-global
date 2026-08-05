import React from "react";
import { ActivityIndicator, Alert, Image, View } from "react-native";
import { router } from "expo-router";
import { ScreenLayout } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Ionicons } from "@expo/vector-icons";
import { useSessions, useRevokeSession } from "@/hooks/useSessions";
import type { SessionSummary } from "@/utils/apiClient";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatLastUsed(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "recently";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export default function ConnectedMerchantsScreen() {
  const { data, isLoading, isError, refetch } = useSessions();
  const { mutate: revoke } = useRevokeSession();

  const sessions = data?.sessions ?? [];

  const confirmRevoke = (session: SessionSummary) => {
    Alert.alert(
      "Revoke access",
      `${session.merchantDisplayName} will no longer be able to take payments from your Xend balance.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: () =>
            revoke(session.id, {
              onError: () =>
                Alert.alert("Couldn't revoke", "Something went wrong. Try again."),
            }),
        },
      ],
      { cancelable: true }
    );
  };

  return (
    <ScreenLayout>
      <View className="flex-1">
        <View className="mt-6">
          <Image
            source={require("@/assets/icons/card.png")}
            className="size-9"
            resizeMode="contain"
          />
        </View>

        <Typography weight="700" className="mt-3 text-3xl text-black">
          Connected Merchants
        </Typography>
        <Typography
          weight="500"
          className="mt-2 text-base leading-6 text-black/40"
        >
          These merchants can take one-tap{"\n"}payments until you revoke them.
        </Typography>

        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        ) : isError ? (
          <View className="flex-1 items-center justify-center">
            <Typography weight="500" className="mb-3 text-base text-black/40">
              Couldn&apos;t load connected merchants.
            </Typography>
            <HapticPressable onPress={() => refetch()} className="p-2">
              <Typography weight="600" className="text-base text-black">
                Retry
              </Typography>
            </HapticPressable>
          </View>
        ) : sessions.length === 0 ? (
          <View className="flex-1 items-center justify-center">
            <View className="mb-4 h-14 w-24 items-center justify-center rounded-full border-2 border-dashed border-black/15 bg-black/[0.03]">
              <Ionicons name="storefront-outline" size={22} color="#00000033" />
            </View>
            <Typography weight="700" className="text-lg text-black">
              No connected merchants yet
            </Typography>
            <Typography weight="500" className="mt-1 text-base text-black/40">
              Merchants you pay appear here.
            </Typography>
          </View>
        ) : (
          <View className="mt-6 flex-1 gap-2">
            {sessions.map((session) => (
              <View
                key={session.id}
                className="flex-row items-center justify-between py-3"
              >
                <View className="flex-1 pr-3">
                  <Typography weight="600" className="text-base text-black">
                    {session.merchantDisplayName}
                  </Typography>
                  <Typography weight="500" className="mt-0.5 text-sm text-black/40">
                    Last used {formatLastUsed(session.lastUsedAt)}
                  </Typography>
                </View>
                <HapticPressable
                  onPress={() => confirmRevoke(session)}
                  className="p-2"
                >
                  <Typography weight="600" className="text-base text-destructive">
                    Revoke
                  </Typography>
                </HapticPressable>
              </View>
            ))}
          </View>
        )}

        <View className="flex-row items-center justify-between">
          <HapticPressable
            onPress={() => router.back()}
            className="h-14 w-14 items-center justify-center rounded-full bg-white shadow-md shadow-black/10"
          >
            <Ionicons name="chevron-back" size={22} color="#000" />
          </HapticPressable>
        </View>
      </View>
    </ScreenLayout>
  );
}
