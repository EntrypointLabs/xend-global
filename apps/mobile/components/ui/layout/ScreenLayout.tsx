import { SafeAreaView } from "react-native-safe-area-context";
import { View, ViewProps } from "react-native";
import { cn } from "@/utils/cn";

export type ScreenLayoutProps = ViewProps & {
  children: React.ReactNode;
  className?: string;
};

export function ScreenLayout({
  children,
  className,
  ...rest
}: ScreenLayoutProps) {
  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className={cn("flex-1 p-5", className)} {...rest}>
        {children}
      </View>
    </SafeAreaView>
  );
}
