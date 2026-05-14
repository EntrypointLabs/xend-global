import { ActivityIndicator } from "react-native";
import { ThemedView } from "./ThemedView";

export function LoadingSpinner() {
  return (
    <ThemedView className="flex-1 items-center justify-center">
      <ActivityIndicator size="large" />
    </ThemedView>
  );
}
