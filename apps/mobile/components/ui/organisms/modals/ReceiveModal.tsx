import React from "react";
import { ActionModal } from "../ActionModal";
import {
  ModalOptionsList,
  ActionOption,
} from "../../molecules/ModalOptionsList";
import { useModalFlow } from "@/contexts/ModalFlowContext";
import { useWalletAddress } from "@/hooks/useWalletAddress";
import { Image, View } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";

const walletIcon = require("@/assets/icons/wallet.png");

interface ReceiveModalProps {
  visible: boolean;
  onClose: () => void;
  onOpenQRCode: () => void;
}

export function ReceiveModal({
  visible,
  onClose,
  onOpenQRCode,
}: ReceiveModalProps) {
  const { hideAllModals } = useModalFlow();
  // Null until the backend has answered with the Account. The option waits
  // rather than falling back to a signer's address, which is not where the
  // Consumer's money belongs.
  const address = useWalletAddress();

  const handleReceiveToWallet = () => {
    hideAllModals();
    onOpenQRCode();
  };

  const receiveOptions: ActionOption[] = [
    {
      key: "crypto",
      title: "Your address",
      description: address
        ? "Share your address or QR code"
        : "Your Account address is not available yet",
      icon: walletIcon,
      onPress: handleReceiveToWallet,
      disabled: !address,
    },
  ];

  return (
    <ActionModal visible={visible} onClose={onClose}>
      <View className="mb-5 flex-col items-center justify-center">
        <Image
          source={require("@/assets/icons/recieve.png")}
          className="mb-5 h-8 w-8"
          resizeMode="contain"
        />
        <Typography weight="600" className="mb-1 text-base">
          Receive
        </Typography>
        <Typography
          weight="500"
          className="max-w-[192px] text-center text-sm text-black/40"
        >
          Money sent to your address lands in your Account
        </Typography>
      </View>
      <ModalOptionsList options={receiveOptions} />
    </ActionModal>
  );
}
