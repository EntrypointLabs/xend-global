import { View, type ViewProps } from "react-native";
import { cn } from "@/utils/cn";

export type ThemedViewProps = ViewProps & {
  className?: string;
  /** @deprecated Theme is class-driven now; use `className` with token utilities. */
  lightColor?: string;
  /** @deprecated Theme is class-driven now; use `className` with token utilities. */
  darkColor?: string;
};

export function ThemedView({
  className,
  lightColor: _lightColor,
  darkColor: _darkColor,
  ...otherProps
}: ThemedViewProps) {
  return <View className={cn("bg-background", className)} {...otherProps} />;
}
