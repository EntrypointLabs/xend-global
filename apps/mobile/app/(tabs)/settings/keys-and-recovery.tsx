import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  ScrollView,
  View,
} from "react-native";
import { router } from "expo-router";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { Ionicons } from "@expo/vector-icons";

import { ScreenLayout } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import type { PopoverAnchor } from "@/components/ui/molecules/ContactActionsPopover";
import { KeyActionsPopover } from "@/components/ui/molecules/KeyActionsPopover";
import {
  KeyExplainerSheet,
  type ExplainedKey,
} from "@/components/ui/organisms/modals/KeyExplainerSheet";
import { PasskeySetupModal } from "@/components/ui/organisms/modals/PasskeySetupModal";
import { useQueryClient } from "@tanstack/react-query";

import { useAccount } from "@/hooks/useAccount";
import { DEVICE_RESTORE_KEY } from "@/hooks/useDeviceNeedsRestore";
import { hardwareKey } from "@/modules/hardware-key/src";
import { usePasskey } from "@/hooks/usePasskey";
import { useRecoveryChange } from "@/hooks/useRecoveryChange";
import { useRecoveryKeys, useRemoveRecoveryKey } from "@/hooks/useRecoveryKeys";
import { explorerAddressUrl } from "@/utils/explorer";
import { MAX_RECOVERY_KEYS } from "@/utils/recovery";
import { truncateAddress } from "@/utils/helper";
import { KEY_COLORS, recoveryKeyColor } from "@/utils/keyColors";
import type { RecoveryKey } from "@/utils/apiClient";

export default function KeysAndRecoveryScreen() {
  const explainerRef = useRef<BottomSheetModal>(null);
  const [explaining, setExplaining] = useState<ExplainedKey>("recovery");
  const [showPasskeySetup, setShowPasskeySetup] = useState(false);
  const [menu, setMenu] = useState<{
    anchor: PopoverAnchor;
    key: RecoveryKey;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: account } = useAccount();
  const queryClient = useQueryClient();

  /**
   * Simulates a lost phone, which is the only way to exercise the restore flow
   * without a second device: it discards this account's Device Key from the
   * Keystore, exactly as a new phone would never have had one. Recoverable
   * only through the flow it exists to test, which is the point.
   */
  const forgetDeviceKey = async () => {
    await hardwareKey.reset();
    await queryClient.invalidateQueries({ queryKey: DEVICE_RESTORE_KEY });
    router.replace("/(tabs)");
  };
  const {
    hasPasskey,
    registerPasskey,
    isRegistering,
    error: passkeyError,
  } = usePasskey();
  const { data: keys, isLoading, error: listError } = useRecoveryKeys();
  const removeKey = useRemoveRecoveryKey();
  const change = useRecoveryChange();

  const busy = removeKey.isPending || change.isPending;
  const count = keys?.length ?? 0;
  const atCapacity = count >= MAX_RECOVERY_KEYS;

  const explain = (subject: ExplainedKey) => {
    setExplaining(subject);
    explainerRef.current?.present();
  };

  const onRemove = async (key: RecoveryKey) => {
    if (!account) return;
    setError(null);
    try {
      await removeKey.mutateAsync(key);
      await change.mutateAsync(account);
    } catch (err) {
      setError(describe(err));
    }
  };

  return (
    <ScreenLayout>
      <View className="flex-1">
        <Image
          source={require("@/assets/icons/keys.png")}
          className="mt-4 size-9"
          resizeMode="contain"
        />

        <Typography weight="700" className="mt-4 text-[20px] text-black">
          Keys & Recovery
        </Typography>
        <Typography
          weight="500"
          className="mt-2 text-[13px] leading-5 text-black/40"
        >
          Manage the keys that control your account.{"\n"}
          Add and remove Recovery Keys.
        </Typography>

        <ScrollView
          className="mt-8 flex-1"
          showsVerticalScrollIndicator={false}
        >
          <Typography weight="600" className="text-[15px] text-black">
            Active Keys
          </Typography>

          <View className="mt-3 flex-row gap-3">
            <ActiveKeyCard
              icon="finger-print-outline"
              tint={KEY_COLORS.passkey}
              name="Passkey"
              detail={hasPasskey ? "Enabled" : "Not set up"}
              onInfo={() => explain("passkey")}
              onPress={hasPasskey ? undefined : () => setShowPasskeySetup(true)}
            />
            <ActiveKeyCard
              icon="phone-portrait-outline"
              tint={KEY_COLORS.device}
              name="Device Key"
              detail={
                account
                  ? truncateAddress(account.signers.approval)
                  : "This phone"
              }
              onInfo={() => explain("device")}
            />
          </View>

          <Typography
            weight="400"
            className="mt-4 text-[12px] leading-[18px] text-black/40"
          >
            Your account needs both Active Keys to authorise a change. If you
            lose one, your Recovery Keys can help restore full access.
          </Typography>

          <View className="mt-8 flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Typography weight="600" className="text-[15px] text-black">
                Recovery Keys
              </Typography>
              <View className="rounded-full bg-black/5 px-2 py-0.5">
                <Typography weight="500" className="text-sm text-black/50">
                  {count}/{MAX_RECOVERY_KEYS}
                </Typography>
              </View>
            </View>
            <HapticPressable
              onPress={() =>
                !atCapacity &&
                router.push("/settings/add-recovery-key" as never)
              }
              disabled={atCapacity || busy}
              className="p-1"
              accessibilityLabel="Add a recovery key"
            >
              <Ionicons
                name="add-outline"
                size={20}
                color={atCapacity ? "#00000026" : "#000000"}
              />
            </HapticPressable>
          </View>

          {isLoading ? (
            <View className="items-center py-10">
              <ActivityIndicator size="small" color="#00000040" />
            </View>
          ) : listError ? (
            <Typography
              weight="500"
              className="mt-4 text-base text-destructive"
            >
              {describe(listError)}
            </Typography>
          ) : (
            <View className="mt-2">
              {(keys ?? []).map((entry, index) => (
                <RecoveryKeyRow
                  key={entry.id}
                  entry={entry}
                  index={index}
                  onMenu={(anchor) => setMenu({ anchor, key: entry })}
                />
              ))}
            </View>
          )}

          <Typography
            weight="400"
            className="mt-5 text-[12px] leading-[18px] text-black/40"
          >
            Recovery Keys help you regain access if you lose one of the Active
            Keys. They can never move money on their own.
          </Typography>

          {(error || passkeyError) && (
            <Typography weight="500" className="mt-4 text-sm text-destructive">
              {error ?? passkeyError}
            </Typography>
          )}

          {__DEV__ && (
            <HapticPressable
              onPress={forgetDeviceKey}
              className="mt-8 items-center p-2"
            >
              <Typography weight="500" className="text-sm text-destructive">
                Forget this phone&apos;s Device Key (dev)
              </Typography>
            </HapticPressable>
          )}
        </ScrollView>

        <HapticPressable
          // To Settings, not back. This screen is reachable from the home
          // banner, and `back` from there returns to the home tab and strands
          // the settings stack on a sub-screen.
          onPress={() => router.navigate("/settings" as never)}
          className="mt-2 size-12 items-center justify-center"
          accessibilityLabel="Back to settings"
        >
          <Ionicons name="chevron-back" size={24} color="#000000" />
        </HapticPressable>
      </View>

      <KeyActionsPopover
        visible={menu !== null}
        anchor={menu?.anchor ?? null}
        onClose={() => setMenu(null)}
        onInfo={() => explain("recovery")}
        onExplorer={() => {
          if (menu) Linking.openURL(explorerAddressUrl(menu.key.address));
        }}
        onDelete={
          menu && (menu.key.removable || menu.key.status === "pending_add")
            ? () => onRemove(menu.key)
            : undefined
        }
        deleteLabel={
          menu?.key.status === "pending_add"
            ? "Cancel this change"
            : "Delete key"
        }
      />

      <KeyExplainerSheet ref={explainerRef} subject={explaining} />

      <PasskeySetupModal
        visible={showPasskeySetup}
        onAddPasskey={async () => {
          const ok = await registerPasskey();
          if (ok) setShowPasskeySetup(false);
        }}
        isLoading={isRegistering}
        error={passkeyError}
        onRetry={registerPasskey}
        onSkip={() => setShowPasskeySetup(false)}
        skipLabel="Cancel"
      />
    </ScreenLayout>
  );
}

function ActiveKeyCard({
  icon,
  tint,
  name,
  detail,
  onInfo,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  name: string;
  detail: string;
  onInfo: () => void;
  onPress?: () => void;
}) {
  return (
    <HapticPressable
      onPress={onPress}
      disabled={!onPress}
      className="flex-1 rounded-3xl border border-black/[0.07] bg-black/[0.02] p-4"
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-1 flex-row items-center gap-2">
          <Ionicons name={icon} size={17} color={tint} />
          <Typography weight="600" className="text-[15px] text-black">
            {name}
          </Typography>
        </View>
        <HapticPressable onPress={onInfo} className="p-1">
          <Ionicons name="ellipsis-horizontal" size={16} color="#00000040" />
        </HapticPressable>
      </View>
      <Typography weight="500" className="mt-5 text-[15px] text-black/40">
        {detail}
      </Typography>
    </HapticPressable>
  );
}

function RecoveryKeyRow({
  entry,
  index,
  onMenu,
}: {
  entry: RecoveryKey;
  index: number;
  onMenu: (anchor: PopoverAnchor) => void;
}) {
  const trigger = useRef<View>(null);

  const open = () => {
    trigger.current?.measureInWindow((x, y, width, height) =>
      onMenu({ x, y, width, height })
    );
  };

  return (
    <View className="py-4">
      <View className="flex-row items-center gap-3">
        <Ionicons
          name={entry.channel === "email" ? "mail" : "wallet"}
          size={17}
          color={recoveryKeyColor(index)}
        />
        <Typography weight="600" className="text-[15px] text-black">
          {entry.channel === "email" ? "Email" : "Wallet"}
        </Typography>

        <Typography
          weight="600"
          className="flex-1 text-right text-[13px] text-black/40"
          numberOfLines={1}
        >
          {entry.channel === "email"
            ? entry.channelValue
            : truncateAddress(entry.channelValue)}
        </Typography>

        <View ref={trigger} collapsable={false}>
          <HapticPressable
            onPress={open}
            className="px-1"
            accessibilityLabel="Key options"
          >
            <Ionicons name="ellipsis-horizontal" size={17} color="#00000040" />
          </HapticPressable>
        </View>
      </View>

      {/* Its own line, under the whole row rather than squeezed beside the
          menu, so the wait reads as being about the key and not about the
          address next to it. */}
      {entry.status !== "active" && <PendingNote status={entry.status} />}
    </View>
  );
}

/**
 * Says the key is not doing anything yet.
 *
 * Both in-flight states get one. A key that is only staged protects nothing,
 * and a row that looked settled would tell the Consumer they are covered a day
 * before they are.
 */
function PendingNote({ status }: { status: RecoveryKey["status"] }) {
  return (
    <View className="mt-1.5 flex-row items-center justify-end gap-1 pr-7">
      <Ionicons name="time-outline" size={12} color="#00000066" />
      <Typography weight="500" className="text-xs text-black/50">
        {status === "pending_add"
          ? "Waiting to become active"
          : "Being removed"}
      </Typography>
    </View>
  );
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong. Try again.";
}
