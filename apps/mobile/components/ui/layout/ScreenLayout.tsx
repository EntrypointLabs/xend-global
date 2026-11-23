import { SafeAreaView } from "react-native-safe-area-context";
import { ThemedView } from "@/components/ui/atoms";
import { ViewProps } from "react-native";
import { cn } from "@/utils/cn";

export type ScreenLayoutProps = ViewProps & {
  children: React.ReactNode;
  className?: string;
  lightColor?: string;
  darkColor?: string;
};

export function ScreenLayout({
  children,
  className,
  lightColor,
  darkColor,
  ...rest
}: ScreenLayoutProps) {
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
