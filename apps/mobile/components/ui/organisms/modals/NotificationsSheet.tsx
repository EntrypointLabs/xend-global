import React, { forwardRef, useCallback, useMemo, useState } from "react";
import { View, Image } from "react-native";
import { Toggle } from "@/components/ui/atoms/Toggle";
import {
  BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { BlurBackdrop } from "@/components/ui/molecules/BlurBackdrop";
import { Ionicons } from "@expo/vector-icons";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";

interface NotificationsSheetProps {
  initialEnabled?: boolean;
  onToggle?: (enabled: boolean) => void;
}

export const NotificationsSheet = forwardRef<
  BottomSheetModal,
  NotificationsSheetProps
>(({ initialEnabled = true, onToggle }, ref) => {
  const snapPoints = useMemo(() => ["48%"], []);
  const [enabled, setEnabled] = useState(initialEnabled);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => <BlurBackdrop {...props} />,
    []
  );

  const handleClose = () => {
    // @ts-ignore - forwarded ref
    ref?.current?.dismiss();
  };

  const handleChange = (value: boolean) => {
    setEnabled(value);
    onToggle?.(value);
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
        <View className="mb-2 flex-row items-start justify-between">
          <Typography weight="700" className="text-xl text-black">
            Notifications
          </Typography>
          <HapticPressable onPress={handleClose} className="p-1">
            <Ionicons name="close" size={22} color="#00000066" />
          </HapticPressable>
        </View>
        <Typography weight="500" className="mb-5 text-base text-black/40">
          Get notified about receiving assets, product updates and more
        </Typography>

        <View className="mb-6 flex-row items-center rounded-2xl bg-black/[0.03] p-4">
          <View className="mr-3 h-9 w-9 items-center justify-center rounded-xl bg-black">
            <Image
              source={require("@/assets/icons/wallet.png")}
              className="size-5"
              resizeMode="contain"
            />
          </View>
          <View className="flex-1">
            <Typography weight="600" className="text-sm text-black">
              Received 100.00 USDC
            </Typography>
            <Typography weight="500" className="text-xs text-black/40">
              From es6J...9QaP
            </Typography>
          </View>
          <Typography weight="500" className="text-xs text-black/40">
            now
          </Typography>
        </View>

        <View className="flex-row items-center justify-between">
          <Typography weight="600" className="text-base text-black">
            Allow notifications
          </Typography>
          <Toggle value={enabled} onValueChange={handleChange} />
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

NotificationsSheet.displayName = "NotificationsSheet";
