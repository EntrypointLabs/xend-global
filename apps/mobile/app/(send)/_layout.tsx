import { Stack, router } from "expo-router";
import { View, TouchableOpacity } from "react-native";
import { useThemeColor } from "@/hooks/useThemeColor";
import { ThemedText, AppIcon } from "@/components/ui/atoms";
import { Ionicons } from "@expo/vector-icons";

export default function SendLayout() {
  const textColor = useThemeColor({}, "text");

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
        <Ionicons name="chevron-back" size={24} color={textColor} />
      </TouchableOpacity>
    );
  };

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerShadowVisible: false,
        headerBackTitle: "Back",
        headerTintColor: textColor,
        headerBackVisible: false,
        headerLeft: () => renderBackButton(),
      }}
    >
      <Stack.Screen
        name="amount"
        options={{
          title: "",
          headerTitle: () => getHeaderTitle("Send Crypto"),
        }}
      />
      <Stack.Screen
        name="fiatamount"
        options={{
          title: "",
          headerTitle: () => getHeaderTitle("Send Fiat"),
        }}
      />
      <Stack.Screen
        name="confirm"
        options={{
          title: "",
          headerTitle: () => getHeaderTitle("Confirm Crypto Transfer"),
        }}
      />
      {/*
        fiatconfirm.tsx deleted in Phase 5 with the rest of the Grid-shaped
        fiat off-ramp; virtual-account on-ramp is out of v1 scope per
        PROJECT.md. fiatamount.tsx kept but its "Continue" handler now leads
        to a dead route until the on-ramp swarm wires a replacement.
      */}
    </Stack>
  );
}
