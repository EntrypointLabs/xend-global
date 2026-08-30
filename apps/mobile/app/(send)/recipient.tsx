import React, { useMemo, useState } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
} from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import { useRouter } from "expo-router";
import { ScreenLayout } from "@/components/ui/layout";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import TabHeaderText from "@/components/ui/atoms/TabHeaderText";
import { cn } from "@/utils/cn";
import { truncateAddress } from "@/utils/helper";
import { useContacts } from "@/hooks/useContacts";
import { useRecentRecipients } from "@/hooks/useRecentRecipients";

const WALLET_ICON = require("@/assets/icons/wallet.png");

export default function ChooseRecipientScreen() {
  const router = useRouter();
  const [recipient, setRecipient] = useState("");
  const { contacts } = useContacts();
  // Saved addresses are listed above under their own name, so repeating them
  // here would put the same wallet on screen twice with two different labels.
  const savedAddresses = useMemo(
    () => contacts.map((c) => c.address),
    [contacts]
  );
  const { recipients } = useRecentRecipients({ exclude: savedAddresses });

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
          <TabHeaderText className="pb-0 text-center">
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
              className={cn(
                "rounded-full px-6 py-2.5",
                recipient.length > 0 ? "bg-black" : "bg-black/30"
              )}
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
                className="mr-1.5"
              />
              <Typography weight="600" className="text-black">
                Paste
              </Typography>
            </HapticPressable>
          </View>
        </View>

        {/* A section with nothing in it is removed rather than shown empty:
            a Consumer who has never sent has no use for a heading telling
            them so. */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {contacts.length > 0 && (
            <>
              <Typography weight="600" className="mb-4 ml-1 text-lg">
                Address book
              </Typography>
              {contacts.map((contact) => (
                <RecipientRow
                  key={contact.address}
                  title={contact.name}
                  subtitle={truncateAddress(contact.address)}
                  onPress={() => setRecipient(contact.address)}
                />
              ))}
            </>
          )}

          {recipients.length > 0 && (
            <>
              <Typography
                weight="600"
                className={cn(
                  "mb-4 ml-1 text-lg",
                  contacts.length > 0 && "mt-4"
                )}
              >
                Recent addresses
              </Typography>
              {recipients.map((entry) => (
                <RecipientRow
                  key={entry.address}
                  title={truncateAddress(entry.address)}
                  subtitle={`${entry.sends} ${entry.sends === 1 ? "send" : "sends"}`}
                  onPress={() => setRecipient(entry.address)}
                />
              ))}
            </>
          )}
        </ScrollView>
      </View>
    </ScreenLayout>
  );
}

/**
 * Sets the whole address, never the shortened one on screen. The mock this
 * replaced filled the field with "AtfW...8DtK", which is not an address and
 * could not have been sent to.
 */
function RecipientRow({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity className="mb-4 flex-row items-center" onPress={onPress}>
      <View className="mr-3 h-12 w-12 items-center justify-center rounded-full border border-[#F2F4F7] bg-white">
        <Image source={WALLET_ICON} className="h-6 w-6" resizeMode="contain" />
      </View>
      <View>
        <Typography weight="700" className="text-base">
          {title}
        </Typography>
        <Typography className="text-sm text-gray-400">{subtitle}</Typography>
      </View>
    </TouchableOpacity>
  );
}
