import React, { useRef } from "react";
import { Image, Platform, View } from "react-native";
import { router } from "expo-router";
import { ActionModal } from "../ActionModal";
import {
  ModalOptionsList,
  ActionOption,
} from "../../molecules/ModalOptionsList";
import { useModalFlow } from "@/contexts/ModalFlowContext";
import { useWalletAddress } from "@/hooks/useWalletAddress";
import { Typography } from "@/components/ui/atoms/Typography";

const bankIcon = require("@/assets/icons/bank.png");
const walletIcon = require("@/assets/icons/wallet.png");

interface ReceiveModalProps {
  visible: boolean;
  onClose: () => void;
  onOpenQRCode: () => void;
  /**
   * Hides the fiat option. Investments holds non-USDC assets, which a bank
   * transfer cannot deliver, so offering fiat there would dead-end.
   */
  cryptoOnly?: boolean;
}

export function ReceiveModal({
  visible,
  onClose,
  onOpenQRCode,
  cryptoOnly = false,
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

  const pendingRoute = useRef<"/add-naira" | null>(null);

  const handleReceiveFromBank = () => {
    hideAllModals();
    onClose();
    if (Platform.OS === "ios") pendingRoute.current = "/add-naira";
    else router.push("/add-naira");
  };

  const handleDismissed = () => {
    const route = pendingRoute.current;
    pendingRoute.current = null;
    if (route) router.push(route);
  };

  const fiatOption: ActionOption = {
    key: "fiat",
    title: "Fiat",
    description: "Add naira by bank transfer",
    icon: bankIcon,
    onPress: handleReceiveFromBank,
  };

  const cryptoOption: ActionOption = {
    key: "crypto",
    title: "Crypto",
    description: "Receive assets via wallet address",
    icon: walletIcon,
    onPress: handleReceiveToWallet,
    disabled: !address,
  };

  const receiveOptions: ActionOption[] = cryptoOnly
    ? [cryptoOption]
    : [fiatOption, cryptoOption];

  return (
    <>
      <ActionModal
        visible={visible}
        onClose={onClose}
        onDismissed={handleDismissed}
      >
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
            Choose how you want to receive money
          </Typography>
        </View>
        <ModalOptionsList options={receiveOptions} />
      </ActionModal>
    </>
  );
}
