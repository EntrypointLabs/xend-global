import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { ThemedView } from "@/components/ui/atoms";
import { View, ViewProps } from "react-native";
import { useInOverlayPane } from "@/contexts/OverlayPaneContext";
import { cn } from "@/utils/cn";

export type ScreenLayoutProps = ViewProps & {
  children: React.ReactNode;
  className?: string;
  lightColor?: string;
  darkColor?: string;
};

/** Room for the overlay's close button, fixed above a pane's top left. */
const PANE_HEADER = 8 + 44;

export function ScreenLayout({
  children,
  className,
  lightColor,
  darkColor,
  ...rest
}: ScreenLayoutProps) {
  const inPane = useInOverlayPane();
  const insets = useSafeAreaInsets();

  // As a pane of the Total Balance overlay the screen sits on that overlay's
  // blur and slides in from off screen. SafeAreaView measures its insets from
  // where the view is, which is wrong while it is off to one side, so a pane
  // takes them from the provider instead.
  if (inPane) {
    return (
      <View
        className="flex-1"
        style={{
          paddingTop: insets.top + PANE_HEADER,
          paddingBottom: insets.bottom,
        }}
      >
        {/* Its own box, so a screen's absolutely placed footer is measured
        from inside the safe area as it is on a page of its own. */}
        <View className={cn("flex-1 px-5 pb-5 pt-3", className)} {...rest}>
          {children}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView
      // Painted here too so the safe-area insets (and, under edge-to-edge, the
      // status/nav bar areas behind them) match the screen instead of showing
      // the window background. A caller-provided lightColor still overrides.
      className="flex-1 bg-background"
      // DYNAMIC-COLOR (caller-provided light theme bg)
      style={lightColor ? { backgroundColor: lightColor } : undefined}
    >
      <ThemedView
        className={cn("flex-1 p-5", className)}
        lightColor={lightColor}
        darkColor={darkColor}
        {...rest}
      >
        {children}
      </ThemedView>
    </SafeAreaView>
  );
}
