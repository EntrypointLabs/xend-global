import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ScreenLayout } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { useAccount } from "@/hooks/useAccount";
import { useRecoveryChange } from "@/hooks/useRecoveryChange";
import {
  useAddRecoveryEmail,
  useAddRecoveryWallet,
  useRotateContactEmail,
} from "@/hooks/useRecoveryKeys";
import { truncateAddress } from "@/utils/helper";

/**
 * Last look before the key is staged, and the two signatures that stage it.
 *
 * The wait is stated here rather than after the fact. Adding a recovery key is
 * a settings change, so it serves out the time lock before it protects
 * anything, and a Consumer who was not told that would believe they were
 * covered a day early. A contact address change is the same change with a
 * key going out as well as one coming in, and the same day of waiting.
 */
export default function ConfirmRecoveryKeyScreen() {
  // One screen for both channels and for the address change: the review, the
  // two signatures and the wait are identical, and only the card differs.
  const { address, email, grantId, intent, current } = useLocalSearchParams<{
    address?: string;
    email?: string;
    grantId?: string;
    intent?: "change";
    current?: string;
  }>();
  const changing = intent === "change";
  const { data: account } = useAccount();
  const addWallet = useAddRecoveryWallet();
  const addEmail = useAddRecoveryEmail();
  const rotateEmail = useRotateContactEmail();
  const change = useRecoveryChange();
  const [error, setError] = useState<string | null>(null);
  const [activeAt, setActiveAt] = useState<string | null>(null);

  const busy =
    addWallet.isPending ||
    addEmail.isPending ||
    rotateEmail.isPending ||
    change.isPending;

  const confirm = async () => {
    // Never silently: the button looks live, and a tap that does nothing reads
    // as a broken screen rather than as "the Account has not loaded yet".
    if (!account) {
      setError("Your account is still loading. Try again in a moment.");
      return;
    }
    setError(null);
    try {
      if (email && grantId && changing) {
        await rotateEmail.mutateAsync({ email, grantId });
      } else if (email && grantId) {
        await addEmail.mutateAsync({ email, grantId });
      } else if (address) {
        await addWallet.mutateAsync(address);
      } else {
        return;
      }
      const outcome = await change.mutateAsync(account);
      setActiveAt(outcome.waitingUntil);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : changing
            ? "Could not change the email."
            : "Could not add the key."
      );
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
              {changing ? "Email change started" : "Recovery Key added"}
            </Typography>
            <Typography
              weight="500"
              className="mt-3 text-center text-base leading-6 text-black/40"
            >
              {changing
                ? `The new address takes over on ${when(activeAt)}. Until then your current address stays on your account, and you can cancel any time before.`
                : `It becomes active on ${when(activeAt)}. Nothing about your account changes until then, and you can cancel it any time before.`}
            </Typography>
          </View>

          <HapticPressable
            onPress={() =>
              router.navigate("/settings/keys-and-recovery" as never)
            }
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
          {changing ? "Change\nemail" : "Add\nRecovery Key"}
        </Typography>

        <Typography weight="500" className="mt-6 text-lg leading-7 text-black">
          {changing
            ? "Please review the new address below\nand confirm to finish."
            : "Please review your new key below\nand confirm to finish."}
        </Typography>

        <View className="mt-8 rounded-3xl bg-black/[0.03] p-5">
          <Typography weight="600" className="text-[15px] text-black">
            {email ? "Email" : "Crypto wallet"}
          </Typography>
          <Typography weight="500" className="mt-4 text-[15px] text-black/40">
            {email ?? truncateAddress(String(address ?? ""), 6, 6)}
          </Typography>
          {changing && current && (
            <Typography
              weight="500"
              className="mt-2 text-[13px] text-black/30"
              numberOfLines={1}
            >
              Replaces {current}
            </Typography>
          )}
        </View>

        <Typography
          weight="400"
          className="mt-5 text-[12px] leading-[18px] text-black/40"
        >
          {changing
            ? "Both Active Keys approve this, then a one day security delay before the new address takes over. Until then the current one stays on your account."
            : "Both Active Keys approve this, then a one day security delay before the key becomes active."}
        </Typography>

        {error && (
          <Typography weight="500" className="mt-4 text-sm text-destructive">
            {error}
          </Typography>
        )}

        <View className="flex-1" />

        <HapticPressable
          onPress={confirm}
          disabled={busy || !account}
          className={`h-14 flex-row items-center justify-center gap-3 rounded-full ${
            busy || !account ? "bg-black/10" : "bg-black"
          }`}
        >
          {busy && <ActivityIndicator size="small" color="#00000040" />}
          <Typography
            weight="700"
            className={`text-lg ${busy || !account ? "text-black/30" : "text-white"}`}
          >
            {busy
              ? "Approving on this device"
              : changing
                ? "Change email"
                : "Add Recovery Key"}
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
