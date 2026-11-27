import { GlassButton } from "@/components/ui/atoms/Glass";
import { View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ScreenLayout } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { usePalette } from "@/hooks/usePalette";

/**
 * Picks which kind of recovery key to add.
 *
 * Both channels are real now. Email is the one most Consumers look for, and it
 * is proved with a code before it is staged, so a recovery key is never an
 * address nobody answers at.
 */
export default function AddRecoveryKeyScreen() {
  return (
    <ScreenLayout>
      <View className="flex-1 px-3">
        <BackButton />

        <Typography
          weight="700"
          className="mt-8 text-5xl leading-[44px] text-foreground"
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
            onPress={() => router.push("/settings/add-recovery-email" as never)}
          />
        </View>
      </View>
    </ScreenLayout>
  );
}

function BackButton() {
  const palette = usePalette();
  return (
    <GlassButton
      radius={999}
      onPress={() => router.back()}
      className="size-10 items-center justify-center rounded-full"
      fallbackClassName="border border-foreground/[0.08] bg-card"
      accessibilityLabel="Go back"
    >
      <Ionicons name="chevron-back" size={20} color={palette.foreground} />
    </GlassButton>
  );
}

function Point({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  const palette = usePalette();
  return (
    <View>
      <View className="flex-row items-center gap-2">
        <Ionicons
          name="checkmark-circle-outline"
          size={17}
          color={palette.foreground}
        />
        <Typography weight="600" className="text-lg text-foreground">
          {heading}
        </Typography>
      </View>
      <Typography
        weight="400"
        className="mt-1 max-w-[85%] text-[13px] leading-[18px] text-foreground/40"
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
  const palette = usePalette();
  const disabled = !onPress;
  return (
    <HapticPressable
      onPress={onPress}
      disabled={disabled}
      className="flex-row items-center gap-4 rounded-3xl bg-foreground/[0.03] px-5 py-[18px]"
    >
      <Ionicons
        name={icon}
        size={20}
        color={disabled ? palette.fg(0.15) : palette.fg(0.4)}
      />
      <View className="flex-1 px-3">
        <Typography
          weight="700"
          className={`text-xl ${disabled ? "text-foreground/30" : "text-foreground"}`}
        >
          {label}
        </Typography>
        {reason && (
          <Typography
            weight="500"
            className="mt-0.5 text-sm text-foreground/30"
          >
            {reason}
          </Typography>
        )}
      </View>
      {!disabled && (
        <Ionicons name="chevron-forward" size={20} color={palette.fg(0.25)} />
      )}
    </HapticPressable>
  );
}
