import { ActivityIndicator, View } from "react-native";

export function LoadingSpinner() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <ActivityIndicator size="large" />
    </View>
  );
}
