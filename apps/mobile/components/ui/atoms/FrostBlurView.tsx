import React, { forwardRef } from "react";
import { BlurView, BlurViewProps } from "expo-blur";
import { useBlurTarget } from "@/contexts/BlurTargetContext";
import { usePalette } from "@/hooks/usePalette";

/**
 * Shared blur intensity for the app's frosted overlays (modals, menus, sheet
 * backdrops). Change it once here to retune every frost at the same time.
 */
export const MODAL_BLUR_INTENSITY = 44.2;

type FrostBlurViewProps = Omit<
  BlurViewProps,
  "blurMethod" | "experimentalBlurMethod" | "blurTarget"
>;

/**
 * BlurView preset for every frosted overlay: the frost of the current mode, blurred on
 * both platforms (iOS blurs natively; Android blurs the app via the shared
 * blurTarget). Callers only pass `style` + children — intensity/tint are
 * overridable but default to the shared frost.
 */
export const FrostBlurView = forwardRef<
  React.ComponentRef<typeof BlurView>,
  FrostBlurViewProps
>(({ intensity = MODAL_BLUR_INTENSITY, tint, ...props }, ref) => {
  const blurTargetRef = useBlurTarget();
  const palette = usePalette();
  return (
    <BlurView
      ref={ref}
      intensity={intensity}
      tint={tint ?? (palette.dark ? "dark" : "light")}
      blurMethod="dimezisBlurView"
      blurTarget={blurTargetRef ?? undefined}
      {...props}
    />
  );
});

FrostBlurView.displayName = "FrostBlurView";
