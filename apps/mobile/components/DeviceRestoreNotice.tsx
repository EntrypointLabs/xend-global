import { useEffect, useState } from "react";
import { View } from "react-native";
import { router, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { useAccount } from "@/hooks/useAccount";
import { useDeviceNeedsRestore } from "@/hooks/useDeviceNeedsRestore";
import { useFinishDeviceRotation } from "@/hooks/useDeviceRotation";

const HOME = "/";

/**
 * Tells a Consumer their phone cannot sign, and offers to fix it.
 *
 * The passkey signs them in on any device, so a new phone shows the whole
 * account and can move nothing: every Spend needs the Device Key, and that one
 * stayed on the phone they lost. Without this they would find out at a payment.
 *
 * A banner rather than a modal. Nothing is broken about looking at the account,
 * and a Consumer who is only checking a balance should not have to dismiss
 * something first. It sits on Home, the screen they land on and come back to.
 */
export function DeviceRestoreNotice() {
  const { data: account } = useAccount();
  const { data: restore } = useDeviceNeedsRestore();
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);

  // Lands the swap once its day is up, on whichever launch comes next.
  useFinishDeviceRotation();

  const atHome = pathname === HOME;
  useEffect(() => {
    if (!atHome) setDismissed(false);
  }, [atHome]);

  const pending = !!account?.pendingApprovalSigner;
  if (!atHome || !restore?.needsRestore || dismissed) return null;

  return (
    <View className="absolute inset-x-4 bottom-28 rounded-3xl bg-black p-5">
      <View className="flex-row items-start gap-3">
        <Ionicons name="phone-portrait-outline" size={20} color="#FFFFFF" />
        <View className="flex-1">
          <Typography weight="600" className="text-[15px] text-white">
            {pending ? "Restoring this phone" : "This phone cannot approve yet"}
          </Typography>
          <Typography
            weight="400"
            className="mt-1 text-sm leading-5 text-white/60"
          >
            {pending
              ? "Your new Device Key is waiting out its one day security delay. Nothing else to do."
              : "Your Device Key is on the phone you set Xend up with. Restore it here to send again."}
          </Typography>
        </View>
        <HapticPressable
          onPress={() => setDismissed(true)}
          accessibilityLabel="Dismiss"
          hitSlop={8}
        >
          <Ionicons name="close" size={18} color="#FFFFFF66" />
        </HapticPressable>
      </View>

      {!pending && (
        <HapticPressable
          onPress={() => router.push("/settings/restore-device" as never)}
          className="mt-4 h-12 items-center justify-center rounded-full bg-white"
        >
          <Typography weight="700" className="text-[15px] text-black">
            Restore this phone
          </Typography>
        </HapticPressable>
      )}
    </View>
  );
}
