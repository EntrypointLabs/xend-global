import { View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ScreenLayout } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";

/**
 * Picks which kind of recovery key to add.
 *
 * Email is shown and refused rather than hidden. It is the channel most
 * Consumers will look for, and an option that quietly does not exist reads as a
 * broken screen; saying why it is unavailable is the honest version.
 */
export default function AddRecoveryKeyScreen() {
  return (
    <ScreenLayout>
      <View className="flex-1 px-3">
        <BackButton />

        <Typography
          weight="700"
          className="mt-8 text-5xl leading-[44px] text-black"
        >
          Add{"\n"}Recovery Key
        </Typography>

        <View className="mt-8 gap-6">
          <Point heading="Wallet recovery">
            A Recovery Key can restore access to your account when paired with
            your Passkey or Device Key. You can have up to 3.
          </Point>
          <Point heading="Recovery only">
            Recovery Keys have limited rights and can never reach your account
            without an Active Key alongside them.
          </Point>
        </View>

        <View className="mt-8 gap-3">
          <Option
            icon="wallet-outline"
            label="Crypto wallet"
            onPress={() =>
              router.push("/settings/add-recovery-wallet" as never)
            }
          />
          <Option
            icon="mail-outline"
            label="Email"
            reason="Not yet available"
          />
        </View>
      </View>
    </ScreenLayout>
  );
}

function BackButton() {
  return (
    <HapticPressable
      onPress={() => router.back()}
      className="size-10 items-center justify-center rounded-full bg-black/[0.08]"
      accessibilityLabel="Go back"
    >
      <Ionicons name="chevron-back" size={20} color="#00000066" />
    </HapticPressable>
  );
}

function Point({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <View>
      <View className="flex-row items-center gap-2">
        <Ionicons name="checkmark-circle-outline" size={17} color="#000000" />
        <Typography weight="600" className="text-lg text-black">
          {heading}
        </Typography>
      </View>
      <Typography
        weight="400"
        className="mt-1 max-w-[85%] text-[13px] leading-[18px] text-black/40"
      >
        {children}
      </Typography>
    </View>
  );
}

function Option({
  icon,
  label,
  onPress,
  reason,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  reason?: string;
}) {
  const disabled = !onPress;
  return (
    <HapticPressable
      onPress={onPress}
      disabled={disabled}
      className="flex-row items-center gap-4 rounded-3xl bg-black/[0.03] px-5 py-[18px]"
    >
      <Ionicons
        name={icon}
        size={20}
        color={disabled ? "#00000026" : "#00000066"}
      />
      <View className="flex-1 px-3">
        <Typography
          weight="700"
          className={`text-xl ${disabled ? "text-black/30" : "text-black"}`}
        >
          {label}
        </Typography>
        {reason && (
          <Typography weight="500" className="mt-0.5 text-sm text-black/30">
            {reason}
          </Typography>
        )}
      </View>
      {!disabled && (
        <Ionicons name="chevron-forward" size={20} color="#00000040" />
      )}
    </HapticPressable>
  );
}
