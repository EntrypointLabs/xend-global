import { ActivityIndicator, Modal, StyleSheet, View } from "react-native";

import { FrostBlurView } from "@/components/ui/atoms/FrostBlurView";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { Typography } from "@/components/ui/atoms/Typography";
import { useCountdown } from "@/hooks/useCountdown";
import { useThemeColor } from "@/hooks/useThemeColor";
import { cn } from "@/utils/cn";

interface PendingChangeModalProps {
  visible: boolean;
  /** ISO-8601, or null while the change has not been approved yet. */
  executableAt: string | null;
  rejecting: boolean;
  error: string | null;
  onReject: () => void;
  onDismiss: () => void;
}

/**
 * Tells a Consumer their account is being changed, and offers the refusal.
 *
 * The body text is deliberately darker than the app's usual muted grey. Half
 * opacity on white lands under the 4.5:1 contrast floor, which is a tolerable
 * trade on copy nobody has to read and the wrong one here: this is the one
 * notice whose whole job is to be read, once, under stress.
 *
 * Deliberately not styled as an alarm. Every phishing popup a Consumer has
 * ever seen is a red panel with a warning triangle, so a genuine security
 * notice that borrows that vocabulary reads as one more thing to dismiss. This
 * is built to look like a statement of fact: a small typographic status label,
 * the deadline written out, and no colour doing the shouting.
 *
 * Rejecting is the primary action and carries the app's ordinary black pill
 * rather than the destructive token, because refusing is the safe move, not the
 * dangerous one. A rejected change can be proposed again; an executed one
 * cannot be taken back. Colouring the safe action like a hazard would push a
 * confused Consumer toward the irreversible half.
 */
export function PendingChangeModal({
  visible,
  executableAt,
  rejecting,
  error,
  onReject,
  onDismiss,
}: PendingChangeModalProps) {
  const backgroundColor = useThemeColor({}, "background");
  const remaining = useCountdown(executableAt);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <FrostBlurView style={[StyleSheet.absoluteFill, styles.overlay]}>
        <View style={[styles.card, { backgroundColor }]}>
          <View className="mb-5 self-start rounded-full border border-destructive/30 px-3 py-1">
            <Typography
              weight="600"
              className="text-[11px] tracking-[1.2px] text-destructive"
            >
              PENDING CHANGE
            </Typography>
          </View>

          <Typography weight="600" className="mb-2 text-xl leading-7">
            Someone is changing your account
          </Typography>

          <Typography
            weight="400"
            className="mb-6 text-sm leading-5 opacity-70"
          >
            {remaining === null
              ? "A change to who can access your Xend account has been started. It needs one more approval before it can go through. If this was not you, reject it now."
              : "A change to who can access your Xend account has been approved. If this was not you, reject it before the time below runs out."}
          </Typography>

          <View className="mb-6 rounded-2xl border border-border px-4 py-3.5">
            <Typography
              weight="500"
              className="mb-1 text-[11px] tracking-[0.8px] opacity-60"
            >
              {remaining === null ? "STATUS" : "GOES THROUGH IN"}
            </Typography>
            <Typography weight="600" className="text-base">
              {remaining === null ? "Waiting for a second approval" : remaining}
            </Typography>
          </View>

          {error ? (
            <Typography
              weight="400"
              className="mb-4 text-sm leading-5 text-destructive"
            >
              {error}
            </Typography>
          ) : null}

          <HapticPressable
            onPress={onReject}
            disabled={rejecting}
            accessibilityRole="button"
            accessibilityLabel="Reject this change"
            className={cn(
              "w-full items-center justify-center rounded-full bg-black py-4",
              rejecting && "opacity-50"
            )}
          >
            {rejecting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Typography weight="600" className="text-base text-white">
                Reject this change
              </Typography>
            )}
          </HapticPressable>

          {/* Offered second and quietly, but offered: a Consumer who did start
              this needs a way out that is not rejecting their own change. */}
          <HapticPressable
            onPress={onDismiss}
            disabled={rejecting}
            accessibilityRole="button"
            accessibilityLabel="I made this change"
            className="mt-3 items-center justify-center py-3"
          >
            <Typography weight="500" className="text-sm opacity-60">
              I made this change
            </Typography>
          </HapticPressable>
        </View>
      </FrostBlurView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  card: {
    width: "93%",
    borderRadius: 32,
    paddingHorizontal: 24,
    paddingVertical: 28,
    margin: 21,
    overflow: "hidden",
  },
});
