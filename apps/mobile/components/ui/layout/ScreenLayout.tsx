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
      className="flex-1"
      // DYNAMIC-COLOR (caller-provided light theme bg)
      style={{ backgroundColor: lightColor }}
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
