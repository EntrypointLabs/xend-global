import React, { useEffect, useState } from "react";
import { Image, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Toggle } from "@/components/ui/atoms/Toggle";
import { Typography } from "@/components/ui/atoms/Typography";
import { ActionModal } from "../ActionModal";

interface NotificationsModalProps {
  visible: boolean;
  onClose: () => void;
  initialEnabled?: boolean;
  onToggle?: (enabled: boolean) => void;
}

export function NotificationsModal({
  visible,
  onClose,
  initialEnabled = true,
  onToggle,
}: NotificationsModalProps) {
  const [enabled, setEnabled] = useState(initialEnabled);

  // The Consumer's stored answer arrives from the server after this mounts, so
  // the toggle has to catch up to it. Local state stays because the flip
  // should feel immediate rather than waiting on a round trip.
  useEffect(() => {
    setEnabled(initialEnabled);
  }, [initialEnabled]);

  const handleChange = (value: boolean) => {
    setEnabled(value);
    onToggle?.(value);
  };

  return (
    <ActionModal visible={visible} onClose={onClose}>
      <View className="mb-5 items-center">
        <View className="mb-5">
          <Ionicons name="notifications-outline" size={30} color="#000" />
        </View>
        <Typography weight="600" className="mb-1 text-base">
          Notifications
        </Typography>
        <Typography
          weight="500"
          className="max-w-[240px] text-center text-sm text-black/40"
        >
          Get notified about receiving assets, product updates and more
        </Typography>
      </View>

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
    </ActionModal>
  );
}
