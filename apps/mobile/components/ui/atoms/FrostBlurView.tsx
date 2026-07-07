import React, { forwardRef } from "react";
import { BlurView, BlurViewProps } from "expo-blur";
import { useBlurTarget } from "@/contexts/BlurTargetContext";

/**
 * Shared blur intensity for the app's frosted overlays (modals, menus, sheet
 * backdrops). Change it once here to retune every frost at the same time.
 */
export const MODAL_BLUR_INTENSITY = 44.2;

type FrostBlurViewProps = Omit<
  BlurViewProps,
  "experimentalBlurMethod" | "blurTarget"
>;

/**
 * BlurView preset for every frosted overlay: light frost with a real blur on
 * both platforms (iOS blurs natively; Android blurs the app via the shared
 * blurTarget). Callers only pass `style` + children — intensity/tint are
 * overridable but default to the shared frost.
 */
export const FrostBlurView = forwardRef<
  React.ComponentRef<typeof BlurView>,
  FrostBlurViewProps
>(({ intensity = MODAL_BLUR_INTENSITY, tint = "light", ...props }, ref) => {
  const blurTargetRef = useBlurTarget();
  return (
    <BlurView
      ref={ref}
      intensity={intensity}
      tint={tint}
      experimentalBlurMethod="dimezisBlurView"
      blurTarget={blurTargetRef ?? undefined}
      {...props}
    />
  );
});

FrostBlurView.displayName = "FrostBlurView";
