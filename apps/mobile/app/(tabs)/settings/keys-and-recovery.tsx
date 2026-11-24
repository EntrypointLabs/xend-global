import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  ScrollView,
  View,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { ScreenLayout } from "@/components/ui/layout";
import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import type { PopoverAnchor } from "@/components/ui/molecules/ContactActionsPopover";
import { KeyActionsPopover } from "@/components/ui/molecules/KeyActionsPopover";
import {
  KeyExplainerModal,
  type ExplainedKey,
} from "@/components/ui/organisms/modals/KeyExplainerModal";
import { PasskeySetupModal } from "@/components/ui/organisms/modals/PasskeySetupModal";
import { useAccount } from "@/hooks/useAccount";
import { usePasskey } from "@/hooks/usePasskey";
import { useRecoveryChange } from "@/hooks/useRecoveryChange";
import { useRecoveryKeys, useRemoveRecoveryKey } from "@/hooks/useRecoveryKeys";
import { explorerAddressUrl } from "@/utils/explorer";
import { MAX_RECOVERY_KEYS } from "@/utils/recovery";
import { truncateAddress } from "@/utils/helper";
import { KEY_COLORS, recoveryKeyColor } from "@/utils/keyColors";
import type { RecoveryKey } from "@/utils/apiClient";
import { usePalette } from "@/hooks/usePalette";

export default function KeysAndRecoveryScreen() {
  const palette = usePalette();
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [explaining, setExplaining] = useState<ExplainedKey>("recovery");
  const [showPasskeySetup, setShowPasskeySetup] = useState(false);
  const [menu, setMenu] = useState<{
    anchor: PopoverAnchor;
    key: RecoveryKey;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: account } = useAccount();
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
    setExplainerOpen(true);
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

        <Typography weight="700" className="mt-4 text-[20px] text-foreground">
          Keys & Recovery
        </Typography>
        <Typography
          weight="500"
          className="mt-2 text-[13px] leading-5 text-foreground/40"
        >
          Manage the keys that control your account.{"\n"}
          Add and remove Recovery Keys.
        </Typography>

        <ScrollView
          className="mt-8 flex-1"
          showsVerticalScrollIndicator={false}
        >
          <Typography weight="600" className="text-[15px] text-foreground">
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
            className="mt-4 text-[12px] leading-[18px] text-foreground/40"
          >
            Your account needs both Active Keys to authorise a change. If you
            lose one, your Recovery Keys can help restore full access.
          </Typography>

          <View className="mt-8 flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Typography weight="600" className="text-[15px] text-foreground">
                Recovery Keys
              </Typography>
              <View className="rounded-full bg-foreground/5 px-2 py-0.5">
                <Typography weight="500" className="text-sm text-foreground/50">
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
                color={atCapacity ? palette.fg(0.15) : palette.foreground}
              />
            </HapticPressable>
          </View>

          {isLoading ? (
            <View className="items-center py-10">
              <ActivityIndicator size="small" color={palette.fg(0.25)} />
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
                  replaced={
                    entry.status === "pending_remove" &&
                    entry.isContactAddress &&
                    (keys ?? []).some(
                      (other) =>
                        other.channel === "email" &&
                        other.status === "pending_add"
                    )
                  }
                  onMenu={(anchor) => setMenu({ anchor, key: entry })}
                />
              ))}
            </View>
          )}

          <Typography
            weight="400"
            className="mt-5 text-[12px] leading-[18px] text-foreground/40"
          >
            Recovery Keys help you regain access if you lose one of the Active
            Keys. They can never move money on their own.
          </Typography>

          {(error || passkeyError) && (
            <Typography weight="500" className="mt-4 text-sm text-destructive">
              {error ?? passkeyError}
            </Typography>
          )}
        </ScrollView>

        <HapticPressable
          // Back, so the page slides away the way it came. `navigate` stacked
          // a second Settings on top and slid it in as a new page. Opened from
          // the home banner, back returns to home, and the tab bar puts the
          // Settings tab on its list whenever it is tapped. A deep link has
          // nothing to go back to, so that case lands on Settings.
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace("/settings" as never)
          }
          className="mt-2 size-12 items-center justify-center"
          accessibilityLabel="Back to settings"
        >
          <Ionicons name="chevron-back" size={24} color={palette.foreground} />
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
        onChange={
          menu && menu.key.isContactAddress && menu.key.status === "active"
            ? () =>
                router.push({
                  pathname: "/settings/add-recovery-email",
                  params: { intent: "change", current: menu.key.channelValue },
                } as never)
            : undefined
        }
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

      <KeyExplainerModal
        visible={explainerOpen}
        onClose={() => setExplainerOpen(false)}
        subject={explaining}
      />

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
  const palette = usePalette();
  return (
    <HapticPressable
      onPress={onPress}
      disabled={!onPress}
      className="flex-1 rounded-3xl border border-foreground/[0.07] bg-foreground/[0.02] p-4"
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-1 flex-row items-center gap-2">
          <Ionicons name={icon} size={17} color={tint} />
          <Typography weight="600" className="text-[15px] text-foreground">
            {name}
          </Typography>
        </View>
        <HapticPressable onPress={onInfo} className="p-1">
          <Ionicons
            name="ellipsis-horizontal"
            size={16}
            color={palette.fg(0.25)}
          />
        </HapticPressable>
      </View>
      <Typography weight="500" className="mt-5 text-[15px] text-foreground/40">
        {detail}
      </Typography>
    </HapticPressable>
  );
}

function RecoveryKeyRow({
  entry,
  index,
  replaced,
  onMenu,
}: {
  entry: RecoveryKey;
  index: number;
  /** On its way out because the contact address is changing, not being deleted. */
  replaced: boolean;
  onMenu: (anchor: PopoverAnchor) => void;
}) {
  const palette = usePalette();
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
        <Typography weight="600" className="text-[15px] text-foreground">
          {entry.channel === "email" ? "Email" : "Wallet"}
        </Typography>
        {entry.isContactAddress && (
          <View className="rounded-full bg-foreground/5 px-2 py-0.5">
            <Typography weight="500" className="text-xs text-foreground/50">
              Contact
            </Typography>
          </View>
        )}

        <Typography
          weight="600"
          className="flex-1 text-right text-[13px] text-foreground/40"
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
            <Ionicons
              name="ellipsis-horizontal"
              size={17}
              color={palette.fg(0.25)}
            />
          </HapticPressable>
        </View>
      </View>

      {/* Its own line, under the whole row rather than squeezed beside the
          menu, so the wait reads as being about the key and not about the
          address next to it. */}
      {entry.status !== "active" && (
        <PendingNote status={entry.status} replaced={replaced} />
      )}
    </View>
  );
}

/**
 * Says the key is not doing anything yet.
 *
 * Both in-flight states get one. A key that is only staged protects nothing,
 * and a row that looked settled would tell the Consumer they are covered a day
 * before they are. The contact key on its way out during an address change
 * says so, because "being removed" on the address they use would read as an
 * attack.
 */
function PendingNote({
  status,
  replaced,
}: {
  status: RecoveryKey["status"];
  replaced: boolean;
}) {
  const palette = usePalette();
  return (
    <View className="mt-1.5 flex-row items-center justify-end gap-1 pr-7">
      <Ionicons name="time-outline" size={12} color={palette.fg(0.4)} />
      <Typography weight="500" className="text-xs text-foreground/50">
        {status === "pending_add"
          ? "Waiting to become active"
          : replaced
            ? "Being replaced"
            : "Being removed"}
      </Typography>
    </View>
  );
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong. Try again.";
}
