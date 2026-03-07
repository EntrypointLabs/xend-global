import React, { useState } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
} from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import { useRouter } from "expo-router";
import { ScreenLayout } from "@/components/ui/layout";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { useThemeColor } from "@/hooks/useThemeColor";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import TabHeaderText from "@/components/ui/atoms/TabHeaderText";

// Mock Recent Addresses
const RECENT_ADDRESSES = [
  {
    name: "AtfW...8DtK",
    sends: "2 sends",
    icon: require("@/assets/icons/wallet.png"),
  },
];

export default function ChooseRecipientScreen() {
  const router = useRouter();
  const [recipient, setRecipient] = useState("");
  const backgroundColor = useThemeColor({}, "background");

  const handlePaste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) {
      setRecipient(text);
    }
  };

  const handleContinue = () => {
    if (recipient.length > 0) {
      router.push({
        pathname: "/(send)/amount",
        params: { recipient: recipient },
      });
    }
  };

  return (
    <ScreenLayout>
      <View className="flex-1 px-4 pt-4">
        {/* Header */}
        <View className="mb-8 flex-row items-center justify-between">
          <View className="h-10 w-10" />
          <TabHeaderText className="text-center">
            Choose recipient
          </TabHeaderText>
          <TouchableOpacity
            onPress={() => router.back()}
            className="h-10 w-10 items-center justify-center"
          >
            <Ionicons name="scan-outline" size={24} color="black" />
          </TouchableOpacity>
        </View>

        {/* Input Container */}
        <View className="mb-8 rounded-[24px] bg-white p-4">
          <Typography className="mb-2 text-base text-gray-400">
            Address or .sol handle
          </Typography>
          <TextInput
            className="mb-4 h-10 text-base text-black"
            placeholder="Enter Solana address or .sol handle"
            placeholderTextColor="#999"
            value={recipient}
            onChangeText={setRecipient}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View className="flex-row gap-3">
            <HapticPressable
              className={`rounded-full px-6 py-2.5 ${recipient.length > 0 ? "bg-black" : "bg-black/30"}`}
              onPress={handleContinue}
              disabled={recipient.length === 0}
            >
              <Typography weight="600" className="text-white">
                Continue
              </Typography>
            </HapticPressable>

            <HapticPressable
              className="flex-row items-center rounded-full bg-gray-100 px-4 py-2.5"
              onPress={handlePaste}
            >
              <Ionicons
                name="document-text-outline"
                size={16}
                color="black"
                style={{ marginRight: 6 }}
              />
              <Typography weight="600" className="text-black">
                Paste
              </Typography>
            </HapticPressable>
          </View>
        </View>

        {/* Recent Addresses */}
        <Typography weight="600" className="mb-4 ml-1 text-lg">
          Recent addresses
        </Typography>

        {RECENT_ADDRESSES.map((item, index) => (
          <TouchableOpacity
            key={index}
            className="mb-4 flex-row items-center"
            onPress={() => setRecipient(item.name)}
          >
            <View className="mr-3 h-12 w-12 items-center justify-center rounded-full border border-[#F2F4F7] bg-white">
              <Image
                source={item.icon}
                className="h-6 w-6"
                resizeMode="contain"
              />
            </View>
            <View>
              <Typography weight="700" className="text-base">
                {item.name}
              </Typography>
              <Typography className="text-sm text-gray-400">
                {item.sends}
              </Typography>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </ScreenLayout>
  );
}
