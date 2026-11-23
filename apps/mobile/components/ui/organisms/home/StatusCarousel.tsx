import { useState } from "react";
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  type StyleProp,
  View,
  type ViewStyle,
} from "react-native";
import { router } from "expo-router";

import { useOnPhoto } from "@/components/ui/glass";
import {
  StatusCard,
  type StatusCardProps,
} from "@/components/ui/organisms/home/StatusCard";
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
import { requestApproval } from "@/utils/approvalRequests";

export type StatusItem = StatusCardProps & { key: string };

interface StatusCarouselProps {
  /** The page for an Account known to hold nothing, or null. */
  empty: StatusItem | null;
  /** Offers for what the Consumer has not tried, shown after everything else. */
  nudges: StatusItem[];
  style?: StyleProp<ViewStyle>;
}

/**
 * Home's status slot, one page at a time: first whatever needs the Consumer,
 * then the empty state, then nudges. Nothing here can be dismissed; each page
 * goes when what it describes stops being true.
 *
 * A carousel rather than a single slot because these arrive independently: a
 * staged settings change is not a reason to stop offering Earn, and Earn is not
 * a reason to bury the change. People rarely swipe past the first page, which
 * is why anything that needs them comes first.
 *
 * A change the Consumer started themselves lands here and nowhere else. It is
 * not an emergency, so it does not interrupt, but it is the only place they can
 * see the wait running down and still call it off, so it must not be silent
 * either.
 */
export function StatusCarousel({ empty, nudges, style }: StatusCarouselProps) {
  const onPhoto = useOnPhoto();
  const { sessionTier, user } = useAuth();
  const { data: account } = useAccount();
  const { data: change } = usePendingAccountChange();
  const { data: restore } = useDeviceNeedsRestore();
  const { data: awaiting } = useAwaitingPayments();
  const { reopen, requestReview } = usePendingChangeAcknowledgement();
  const { startedHere } = useInitiatedChanges();
  const passkey = usePasskeyLogin();
  const [passkeyHint, setPasskeyHint] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [width, setWidth] = useState(0);
  const remaining = useCountdown(change?.executableAt ?? null);

  const banners: StatusItem[] = [];

  // Before everything, including a waiting Payment: nothing else on the
  // screen can be finished until this is. An email code opened this session,
  // so it can look and nothing more, and the passkey is the one thing that
  // changes that. Signing in with it replaces the session in place and this
  // card goes with it.
  if (sessionTier === "entry") {
    const upgrade = async () => {
      if (passkey.busy) return;
      setPasskeyHint(null);
      const outcome = await passkey.signIn(user?.id);
      if (outcome === "wrong-account") {
        const opened = passkey.wrongAccountEmail();
        setPasskeyHint(
          opened
            ? `That passkey opens ${opened}`
            : "That passkey opens another account"
        );
      } else if (outcome === "no-account") {
        setPasskeyHint("That passkey is not on any account");
      } else if (outcome === "no-passkey") {
        setPasskeyHint("No passkey on this phone");
      } else if (outcome === "failed") {
        setPasskeyHint("That did not work. Tap to retry");
      }
    };
    banners.push({
      key: "entry-session",
      art: "passkey",
      title: "Looking, not spending",
      subtitle: passkey.busy
        ? "Waiting for your passkey"
        : (passkeyHint ?? "Sign in with your passkey to send"),
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
      art: "payment",
      title:
        waiting.length === 1
          ? "Finish your payment"
          : `${waiting.length} payments need you`,
      subtitle:
        waiting.length === 1
          ? `${waiting[0].merchantDisplayName} is waiting`
          : "Tap to finish them",
      onPress: () =>
        waiting.length === 1
          ? requestApproval(waiting[0].reference)
          : router.push("/settings/finish-payment" as never),
    });
  }

  if (change && restoring) {
    banners.push({
      key: "pending-change",
      art: "phone",
      title: mine ? "Recovering this phone" : "A phone is being added",
      subtitle: remaining
        ? `Takes over in ${remaining}`
        : "Waiting on approval",
      // Review means the same thing either way here: the screen that shows the
      // wait running down and still offers to call it off. Asked for, so it
      // opens even on the phone that started the change.
      onPress: requestReview,
    });
  } else if (change) {
    banners.push({
      key: "pending-change",
      art: "clock",
      title: mine ? "Key change on its way" : "Account change pending",
      subtitle: remaining
        ? `Goes through in ${remaining}`
        : "Waiting for a second approval",
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
      art: "phone",
      title: "This phone can't approve",
      subtitle: "Your key is on another phone",
      onPress: () => router.push("/settings/restore-device" as never),
    });
  }

  if (empty) banners.push(empty);
  banners.push(...nudges);

  const onLayout = (event: LayoutChangeEvent) =>
    setWidth(event.nativeEvent.layout.width);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width > 0) {
      setPage(Math.round(event.nativeEvent.contentOffset.x / width));
    }
  };

  if (banners.length === 0) return null;
  // A page can disappear while it is showing, such as a payment just finished.
  const current = Math.min(page, banners.length - 1);

  return (
    <View style={style} onLayout={onLayout}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        scrollEnabled={banners.length > 1}
      >
        {banners.map(({ key, ...card }) => (
          <View key={key} style={{ width }}>
            <StatusCard {...card} />
          </View>
        ))}
      </ScrollView>

      {banners.length > 1 && (
        <View className="mt-2.5 flex-row items-center justify-center gap-1.5">
          {banners.map((banner, index) => (
            <View
              key={banner.key}
              className={cn(
                "size-1.5 rounded-full",
                index === current
                  ? onPhoto
                    ? "bg-white/80"
                    : "bg-foreground/45"
                  : onPhoto
                    ? "bg-white/30"
                    : "bg-foreground/10"
              )}
            />
          ))}
        </View>
      )}
    </View>
  );
}
