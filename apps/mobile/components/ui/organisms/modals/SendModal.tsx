import React from "react";
import { ActionModal } from "../ActionModal";
import {
  ModalOptionsList,
  ActionOption,
} from "../../molecules/ModalOptionsList";
import { Image, View } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";

const walletIcon = require("@/assets/icons/wallet.png");

interface SendModalProps {
  visible: boolean;
  onClose: () => void;
  onSendToWallet: () => void;
}

export function SendModal({
  visible,
  onClose,
  onSendToWallet,
}: SendModalProps) {
  const handleSendToWallet = () => {
    onClose();
    onSendToWallet();
  };

  const sendOptions: ActionOption[] = [
    {
      key: "crypto",
      title: "To an address",
      description: "Send to a Solana address or .sol name",
      icon: walletIcon,
      onPress: handleSendToWallet,
    },
  ];

  return (
    <ActionModal visible={visible} onClose={onClose}>
      <View className="mb-5 flex-col items-center justify-center">
        <Image
          source={require("@/assets/icons/send.png")}
          className="mb-5 h-8 w-8"
          resizeMode="contain"
        />
        <Typography weight="600" className="mb-1 text-base">
          Send
        </Typography>
        <Typography
          weight="500"
          className="max-w-[192px] text-center text-sm text-black/40"
        >
          Choose where the money goes
        </Typography>
      </View>
      <ModalOptionsList options={sendOptions} />
    </ActionModal>
  );
}
