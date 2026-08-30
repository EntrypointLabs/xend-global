import { useRef, useState } from "react";
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  View,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";
import { useAuth } from "@/contexts/AuthContext";
import { useAccount } from "@/hooks/useAccount";
import { useAwaitingPayments } from "@/hooks/useAwaitingPayments";
import { useCountdown } from "@/hooks/useCountdown";
import { useDeviceNeedsRestore } from "@/hooks/useDeviceNeedsRestore";
import { usePendingAccountChange } from "@/hooks/usePendingAccountChange";
import { useInitiatedChanges } from "@/hooks/useInitiatedChange";
import { usePendingChangeAcknowledgement } from "@/hooks/usePendingChangeAcknowledgement";
import { usePasskeyLogin } from "@/hooks/usePasskeyLogin";
import { cn } from "@/utils/cn";

/** The card is inset by the screen's own padding on both sides. */
const SCREEN_PADDING = 20;

interface Banner {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  title: string;
  description: string;
  onPress: () => void;
}

/**
 * The notices at the foot of the home screen, one page at a time.
 *
 * A carousel rather than a single slot because these arrive independently: a
 * staged settings change is not a reason to stop telling someone about Earn,
 * and Earn is not a reason to bury the change.
 *
 * A change the Consumer started themselves lands here and nowhere else. It is
 * not an emergency, so it does not interrupt, but it is the only place they can
 * see the wait running down and still call it off, so it must not be silent
 * either.
 */
export function HomeBanners() {
  const { sessionTier } = useAuth();
  const { data: account } = useAccount();
  const { data: change } = usePendingAccountChange();
  const { data: restore } = useDeviceNeedsRestore();
  const { data: awaiting } = useAwaitingPayments();
  const { reopen, requestReview } = usePendingChangeAcknowledgement();
  const { startedHere } = useInitiatedChanges();
  const passkey = usePasskeyLogin();
  const [passkeyHint, setPasskeyHint] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const width = useRef(Dimensions.get("window").width - SCREEN_PADDING * 2);
  const remaining = useCountdown(change?.executableAt ?? null);

  const banners: Banner[] = [];

  // Before everything, including a waiting Payment: nothing else on the
  // screen can be finished until this is. An email code opened this session,
  // so it can look and nothing more, and the passkey is the one thing that
  // changes that. Signing in with it replaces the session in place and this
  // card goes with it.
  if (sessionTier === "entry") {
    const upgrade = async () => {
      if (passkey.busy) return;
      setPasskeyHint(null);
      const outcome = await passkey.signIn();
      if (outcome === "no-passkey") {
        setPasskeyHint("No passkey on this phone. Use the phone that has it.");
      } else if (outcome === "failed") {
        setPasskeyHint(passkey.error ?? "That did not work. Tap to try again.");
      }
    };
    banners.push({
      key: "entry-session",
      icon: "finger-print-outline",
      tint: "#0A0A0A",
      title: "Looking, not spending",
      description: passkey.busy
        ? "Waiting for your passkey."
        : (passkeyHint ??
          "Sending and key changes need your passkey. Tap to sign in."),
      onPress: () => void upgrade(),
    });
  }

  // Whose change it is, decided by this device. A phone that did not start it
  // is either the Consumer's other phone or somebody else's, and both want the
  // wording that treats it as something to refuse.
  const mine = change ? startedHere(change.transactionIndex) : false;
  // A rotation is a pending change like any other, so it gets one banner
  // rather than two: the wording is the only thing that differs.
  const restoring = !!account?.pendingApprovalSigner;

  // First, and above everything else here. Somebody with a Payment waiting was
  // told to open the app by a checkout they are still standing at, so it has to
  // be the thing they see, not a card they have to swipe to.
  const waiting = awaiting ?? [];
  if (waiting.length > 0) {
    banners.push({
      key: "finish-payment",
      icon: "storefront-outline",
      tint: "#0A0A0A",
      title:
        waiting.length === 1
          ? `Finish paying ${waiting[0].merchantDisplayName}`
          : `${waiting.length} payments need you`,
      description: "Checked twice at this size. Tap to finish.",
      onPress: () => router.push("/settings/finish-payment" as never),
    });
  }

  if (change && restoring) {
    banners.push({
      key: "pending-change",
      icon: "phone-portrait-outline",
      tint: "#0A0A0A",
      title: mine ? "Restoring this phone" : "A phone is being added",
      description: remaining
        ? `Takes over in ${remaining}. Tap to review.`
        : "Waiting on approval. Tap to review.",
      // Review means the same thing either way here: the screen that shows the
      // wait running down and still offers to call it off. Asked for, so it
      // opens even on the phone that started the change.
      onPress: requestReview,
    });
  } else if (change) {
    banners.push({
      key: "pending-change",
      icon: "time-outline",
      tint: "#0A0A0A",
      title: mine
        ? "Your key change is on its way"
        : "A change to your account is pending",
      description: remaining
        ? `Goes through in ${remaining}. Tap to review.`
        : "Waiting for a second approval. Tap to review.",
      // Reviewing means two different things depending on whose change it is.
      // Their own is a key they can watch land, and the key list is where it
      // lives. Somebody else's is a thing to refuse, and the only screen that
      // offers that is the notice they dismissed to get here, so tapping puts
      // it back rather than sending them to a list that says nothing about it.
      onPress: mine
        ? () => router.push("/settings/keys-and-recovery" as never)
        : reopen,
    });
  } else if (restore?.needsRestore) {
    // Ahead of everything except a Payment somebody is waiting to finish: until
    // this is done the Account can be looked at and not spent from, and nothing
    // else on the screen explains why.
    banners.push({
      key: "device-restore",
      icon: "phone-portrait-outline",
      tint: "#0A0A0A",
      title: "This phone cannot approve",
      description: "Your Device Key is on another phone. Tap to restore it.",
      onPress: () => router.push("/settings/restore-device" as never),
    });
  }

  banners.push({
    key: "earn",
    icon: "trending-up-outline",
    tint: "#0080FF",
    title: "Earn up to 4.93% APY",
    description: "Put USDC into Earn",
    onPress: () => router.push("/earn"),
  });

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(event.nativeEvent.contentOffset.x / width.current));
  };

  return (
    <View className="mb-4 mt-auto">
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        scrollEnabled={banners.length > 1}
      >
        {banners.map((banner) => (
          <View key={banner.key} style={{ width: width.current }}>
            <BannerCard banner={banner} />
          </View>
        ))}
      </ScrollView>

      {banners.length > 1 && (
        <View className="mt-2 flex-row items-center justify-center gap-1.5">
          {banners.map((banner, index) => (
            <View
              key={banner.key}
              className={cn(
                "size-1.5 rounded-full",
                index === page ? "bg-black/40" : "bg-black/10"
              )}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function BannerCard({ banner }: { banner: Banner }) {
  return (
    <HapticPressable
      onPress={banner.onPress}
      className="flex-row items-center justify-between rounded-[20px] border border-black/[0.05] bg-white p-4"
    >
      <View className="flex-1 flex-row items-center">
        <View
          className="mr-3 size-10 items-center justify-center rounded-full"
          // DYNAMIC-COLOR (per-banner icon tint)
          style={{ backgroundColor: banner.tint }}
        >
          <Ionicons name={banner.icon} size={18} color="#FFFFFF" />
        </View>
        <View className="flex-1 gap-0.5">
          <Typography weight="600" className="text-[15px] text-black">
            {banner.title}
          </Typography>
          <Typography weight="500" className="text-[13px] text-black/50">
            {banner.description}
          </Typography>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#00000040" />
    </HapticPressable>
  );
}
