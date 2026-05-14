import { View, type ViewProps } from "react-native";
import { useThemeColor } from "@/hooks/useThemeColor";

export type ThemedViewProps = ViewProps & {
  className?: string;
  lightColor?: string;
  darkColor?: string;
};

export function ThemedView({
  className,
  lightColor,
  darkColor,
  style,
  ...otherProps
}: ThemedViewProps) {
  const backgroundColor = useThemeColor(
    { light: lightColor, dark: darkColor },
    "background"
  );

  return (
    <View
      className={className}
      // DYNAMIC-COLOR (system theme via useThemeColor; honors lightColor/darkColor overrides)
      style={[{ backgroundColor }, style]}
      {...otherProps}
    />
  );
}
