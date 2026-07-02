import { View, TouchableOpacity } from "react-native";
import { ThemedText, IconSymbol } from "@/components/ui/atoms";
import QRCode from "react-native-qrcode-svg";
import { useState, useMemo } from "react";
import * as Clipboard from "expo-clipboard";

interface WalletQRCodeProps {
  walletAddress: string;
}

export default function WalletQRCode({ walletAddress }: WalletQRCodeProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const qrCode = useMemo(
    () => (
      <QRCode
        value={walletAddress || "sjknskjsns"}
        size={200}
        color="white"
        backgroundColor="#000033"
        ecl="L"
      />
    ),
    [walletAddress]
  );

  return (
    <View className="flex-1 items-center justify-evenly">
      <ThemedText type="large" className="text-white">
        Bright
      </ThemedText>
      {qrCode}
      <ThemedText type="default" className="text-center text-white">
        {walletAddress}
      </ThemedText>
      <View className="flex-row opacity-40">
        <IconSymbol name="info.circle" size={16} color="white" />
        <ThemedText type="tiny" className="ml-1 py-0.5 text-center text-white">
          We only support USDC.
        </ThemedText>
      </View>
      <TouchableOpacity className="flex-row items-center" onPress={handleCopy}>
        <IconSymbol
          name={copied ? "checkmark.circle" : "doc.on.doc"}
          size={16}
          color="white"
        />
        <ThemedText type="regularSemiBold" className="text-white">
          {copied ? "Copied!" : "Copy"}
        </ThemedText>
      </TouchableOpacity>
    </View>
  );
}
