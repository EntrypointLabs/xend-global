import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ScreenLayout } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { useAccount } from "@/hooks/useAccount";
import { useRecoveryChange } from "@/hooks/useRecoveryChange";
import { useAddRecoveryWallet } from "@/hooks/useRecoveryKeys";
import { truncateAddress } from "@/utils/helper";

/**
 * Last look before the key is staged, and the two signatures that stage it.
 *
 * The wait is stated here rather than after the fact. Adding a recovery key is
 * a settings change, so it serves out the time lock before it protects
 * anything, and a Consumer who was not told that would believe they were
 * covered a day early.
 */
export default function ConfirmRecoveryKeyScreen() {
  const { address } = useLocalSearchParams<{ address: string }>();
  const { data: account } = useAccount();
  const addWallet = useAddRecoveryWallet();
  const change = useRecoveryChange();
  const [error, setError] = useState<string | null>(null);
  const [activeAt, setActiveAt] = useState<string | null>(null);

  const busy = addWallet.isPending || change.isPending;

  const confirm = async () => {
    if (!account || !address) return;
    setError(null);
    try {
      await addWallet.mutateAsync(address);
      const outcome = await change.mutateAsync(account);
      setActiveAt(outcome.waitingUntil);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the key.");
    }
  };

  if (activeAt !== null) {
    return (
      <ScreenLayout>
        <View className="flex-1 px-3">
          <View className="flex-1 items-center justify-center">
            <View className="size-16 items-center justify-center rounded-3xl bg-black">
              <Ionicons name="time-outline" size={30} color="#FFFFFF" />
            </View>
            <Typography weight="700" className="mt-6 text-3xl text-black">
              Recovery Key added
            </Typography>
            <Typography
              weight="500"
              className="mt-3 text-center text-base leading-6 text-black/40"
            >
              It becomes active on {when(activeAt)}. Nothing about your account
              changes until then, and you can cancel it any time before.
            </Typography>
          </View>

          <HapticPressable
            onPress={() => router.dismissAll()}
            className="h-14 items-center justify-center rounded-full bg-black"
          >
            <Typography weight="700" className="text-[15px] text-white">
              Done
            </Typography>
          </HapticPressable>
        </View>
      </ScreenLayout>
    );
  }

  return (
    <ScreenLayout>
      <View className="flex-1 px-3">
        <HapticPressable
          onPress={() => router.back()}
          disabled={busy}
          className="size-10 items-center justify-center rounded-full bg-black/[0.08]"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={20} color="#00000066" />
        </HapticPressable>

        <Typography
          weight="700"
          className="mt-8 text-5xl leading-[44px] text-black"
        >
          Add{"\n"}Recovery Key
        </Typography>

        <Typography weight="500" className="mt-6 text-lg leading-7 text-black">
          Please review your new key below{"\n"}and confirm to finish.
        </Typography>

        <View className="mt-8 rounded-3xl bg-black/[0.03] p-5">
          <Typography weight="600" className="text-[15px] text-black">
            Crypto wallet
          </Typography>
          <Typography weight="500" className="mt-4 text-[15px] text-black/40">
            {truncateAddress(String(address ?? ""), 6, 6)}
          </Typography>
        </View>

        <Typography
          weight="400"
          className="mt-5 text-[12px] leading-[18px] text-black/40"
        >
          Both Active Keys approve this, then a one day security delay before
          the key becomes active.
        </Typography>

        {error && (
          <Typography weight="500" className="mt-4 text-sm text-destructive">
            {error}
          </Typography>
        )}

        <View className="flex-1" />

        <HapticPressable
          onPress={confirm}
          disabled={busy}
          className={`h-14 flex-row items-center justify-center gap-3 rounded-full ${
            busy ? "bg-black/10" : "bg-black"
          }`}
        >
          {busy && <ActivityIndicator size="small" color="#00000040" />}
          <Typography
            weight="700"
            className={`text-lg ${busy ? "text-black/30" : "text-white"}`}
          >
            {busy ? "Approving on this device" : "Add Recovery Key"}
          </Typography>
        </HapticPressable>
      </View>
    </ScreenLayout>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}
