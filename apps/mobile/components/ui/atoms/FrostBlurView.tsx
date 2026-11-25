import React, { forwardRef } from "react";
import { View } from "react-native";
import { BlurView, BlurViewProps } from "expo-blur";
import { useBlurTarget } from "@/contexts/BlurTargetContext";
import { usePalette } from "@/hooks/usePalette";

/**
 * Shared blur intensity for the app's frosted overlays (modals, menus, sheet
 * backdrops). Change it once here to retune every frost at the same time.
 */
export const MODAL_BLUR_INTENSITY = 30;

/**
 * The grey laid over the blur behind a sheet. A white frost behind a white
 * sheet hides the sheet's edges; a grey one, as Fuse uses, lets the sheet
 * stand out. 26% matches the grey Fuse's backdrop measures over white.
 */
export const FROST_VEIL = { light: "bg-black/[0.26]", dark: "bg-black/50" };

type FrostBlurViewProps = Omit<
  BlurViewProps,
  "blurMethod" | "experimentalBlurMethod" | "blurTarget"
> & {
  /** Off for a surface that is itself the page, not a backdrop behind one. */
  veil?: boolean;
};

/**
 * BlurView preset for every frosted overlay, blurred on both platforms (iOS
 * blurs natively; Android blurs the app via the shared blurTarget). Callers
 * only pass `style` + children; intensity/tint are overridable but default to
 * the shared frost.
 */
export const FrostBlurView = forwardRef<
  React.ComponentRef<typeof BlurView>,
  FrostBlurViewProps
>(
  (
    { intensity = MODAL_BLUR_INTENSITY, tint, veil = true, children, ...props },
    ref
  ) => {
    const blurTargetRef = useBlurTarget();
    const palette = usePalette();
    return (
      <BlurView
        ref={ref}
        intensity={intensity}
        // The neutral material, not "light": light washes everything behind
        // toward white, which is the glare the veil is there to replace.
        tint={tint ?? (palette.dark ? "dark" : "default")}
        blurMethod="dimezisBlurView"
        blurTarget={blurTargetRef ?? undefined}
        {...props}
      >
        {veil ? (
          <View
            pointerEvents="none"
            className={`absolute inset-0 ${palette.dark ? FROST_VEIL.dark : FROST_VEIL.light}`}
          />
        ) : null}
        {children}
      </BlurView>
    );
  }
);

FrostBlurView.displayName = "FrostBlurView";
