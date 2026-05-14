import React, { useRef } from "react";
import { Image, View } from "react-native";
import { router } from "expo-router";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { ScreenLayout } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import { ScreenActionFooter } from "@/components/ui/molecules";
import { InfoSheet } from "@/components/ui/organisms/modals/InfoSheet";
import { Ionicons } from "@expo/vector-icons";
import HapticPressable from "@/components/ui/atoms/HapticPressable";

export default function SpendingLimitsScreen() {
  const infoSheetRef = useRef<BottomSheetModal>(null);

  return (
    <ScreenLayout>
      <View className="flex-1">
        <View className="mt-6 flex-row items-start justify-between">
          <Image
            source={require("@/assets/icons/spending-limt.png")}
            className="size-9"
            resizeMode="contain"
          />
          <HapticPressable
            onPress={() => infoSheetRef.current?.present()}
            className="p-1"
          >
            <Ionicons
              name="information-circle-outline"
              size={22}
              color="#00000066"
            />
          </HapticPressable>
        </View>

        <Typography weight="700" className="mt-3 text-3xl text-black">
          Spending Limits
        </Typography>
        <Typography
          weight="500"
          className="mt-2 text-base leading-6 text-black/40"
        >
          The limit determines the amount{"\n"}
          that can be sent without using 2FA key.
        </Typography>

        <View className="flex-1 items-center justify-center">
          <View className="mb-4 h-14 w-24 rounded-full border-2 border-dashed border-black/15 bg-black/[0.03]" />
          <Typography weight="700" className="text-lg text-black">
            No Spending Limits yet
          </Typography>
          <Typography weight="500" className="mt-1 text-base text-black/40">
            Add a Spending Limit
          </Typography>
        </View>

        <ScreenActionFooter
          onBack={() => router.back()}
          actionLabel="Add Spending Limit"
          onAction={() => infoSheetRef.current?.present()}
        />
      </View>

      <InfoSheet
        ref={infoSheetRef}
        iconName="time-outline"
        iconBackground="#FF8A1F"
        title="Spending Limits"
        description={
          <>
            <Typography
              weight="400"
              className="text-center text-base leading-6 text-black/50"
            >
              If you decide to enhance your security by using an external 2FA
              Key, you won&apos;t need to carry it with you for everyday tasks.
            </Typography>
            <Typography
              weight="400"
              className="text-center text-base leading-6 text-black/50"
            >
              Simply set a Spending Limit, and your wallet can handle
              transactions within that limit without requiring 2FA.
            </Typography>
          </>
        }
        actionLabel="Got it"
      />
    </ScreenLayout>
  );
}
