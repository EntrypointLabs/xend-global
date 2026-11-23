import { Stack, router } from "expo-router";
import { View, TouchableOpacity } from "react-native";
import { usePalette } from "@/hooks/usePalette";
import { ThemedText, AppIcon } from "@/components/ui/atoms";
import { Ionicons } from "@expo/vector-icons";

export default function SendLayout() {
  const palette = usePalette();

  const getHeaderTitle = (title: string) => {
    return (
      <View className="flex-row items-center">
        <ThemedText type="defaultSemiBold" className="mr-2">
          {title}
        </ThemedText>
        <AppIcon name="sent" size={24} />
      </View>
    );
  };

  const renderBackButton = () => {
    return (
      <TouchableOpacity onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={24} color={palette.foreground} />
      </TouchableOpacity>
    );
  };

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerShadowVisible: false,
        headerBackTitle: "Back",
        headerTintColor: palette.foreground,
        headerStyle: { backgroundColor: palette.background },
        headerBackVisible: false,
        headerLeft: () => renderBackButton(),
      }}
    >
      <Stack.Screen
        name="fiatamount"
        options={{
          title: "",
          headerTitle: () => getHeaderTitle("Send Fiat"),
        }}
      />
    </Stack>
  );
}
