import React, { forwardRef, useCallback, useMemo } from "react";
import { View } from "react-native";
import {
  BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { BlurBackdrop } from "@/components/ui/molecules/BlurBackdrop";
import { Ionicons } from "@expo/vector-icons";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";

interface InfoSheetProps {
  title: string;
  description: React.ReactNode;
  iconName: keyof typeof Ionicons.glyphMap;
  iconBackground: string;
  iconColor?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const InfoSheet = forwardRef<BottomSheetModal, InfoSheetProps>(
  (
    {
      title,
      description,
      iconName,
      iconBackground,
      iconColor = "#FFFFFF",
      actionLabel = "Got it",
      onAction,
    },
    ref
  ) => {
    const snapPoints = useMemo(() => ["48%"], []);

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => <BlurBackdrop {...props} />,
      []
    );

    const handleAction = () => {
      onAction?.();
      // @ts-ignore - ref forwarded from parent
      ref?.current?.dismiss();
    };

    const handleClose = () => {
      // @ts-ignore - ref forwarded from parent
      ref?.current?.dismiss();
    };

    return (
      <BottomSheetModal
        ref={ref}
        index={0}
        snapPoints={snapPoints}
        backdropComponent={renderBackdrop}
        enablePanDownToClose
        handleIndicatorStyle={{ display: "none" }}
        backgroundStyle={{
          backgroundColor: "#FFFFFF",
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
        }}
        containerStyle={{ zIndex: 100 }}
      >
        <BottomSheetView className="flex-1 px-6 pb-8 pt-5">
          <View className="mb-4 flex-row items-start justify-between">
            <View
              className="h-12 w-12 items-center justify-center rounded-2xl"
              style={{ backgroundColor: iconBackground }}
            >
              <Ionicons name={iconName} size={24} color={iconColor} />
            </View>
            <HapticPressable onPress={handleClose} className="p-1">
              <Ionicons name="close" size={22} color="#00000066" />
            </HapticPressable>
          </View>

          <Typography weight="700" className="mb-3 text-center text-xl">
            {title}
          </Typography>

          <View className="mb-6 gap-3">
            {typeof description === "string" ? (
              <Typography
                weight="400"
                className="text-center text-base leading-6 text-black/50"
              >
                {description}
              </Typography>
            ) : (
              description
            )}
          </View>

          <HapticPressable
            onPress={handleAction}
            className="items-center justify-center rounded-full bg-black/5 py-4"
          >
            <Typography weight="600" className="text-base text-black">
              {actionLabel}
            </Typography>
          </HapticPressable>
        </BottomSheetView>
      </BottomSheetModal>
    );
  }
);

InfoSheet.displayName = "InfoSheet";
