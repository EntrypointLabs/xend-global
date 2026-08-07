import React from "react";
import { ActionModal } from "../ActionModal";
import {
  ModalOptionsList,
  ActionOption,
} from "../../molecules/ModalOptionsList";
import { useModalFlow } from "@/contexts/ModalFlowContext";
import { router } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { useKyc } from "@/hooks/useKyc";
import { Image, View } from "react-native";
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
  const { accountInfo } = useAuth();
  const { hideAllModals } = useModalFlow();
  const { isBankLoading, isBankDisabled, status, tosStatus } = useKyc();

  const handleReceiveToWallet = () => {
    hideAllModals();
    onOpenQRCode();
  };

  const handleReceiveFromBank = async () => {
    if (isBankLoading) return;

    if (
      status === "not_started" ||
      status === "incomplete" ||
      tosStatus === "pending"
    ) {
      hideAllModals();
      router.push({ pathname: "/kyc", params: { source: "receive" } });
      return;
    }

    hideAllModals();
    router.push("/bankdetails");
  };

  const fiatOption: ActionOption = {
    key: "fiat",
    title: "Fiat",
    description: "Receive assets via bank Account",
    icon: bankIcon,
    onPress: handleReceiveFromBank,
    disabled: isBankDisabled,
  };

  const cryptoOption: ActionOption = {
    key: "crypto",
    title: "Crypto",
    description: "Receive assets via wallet address",
    icon: walletIcon,
    onPress: handleReceiveToWallet,
    disabled: accountInfo?.smart_account_address === null,
  };

  const receiveOptions: ActionOption[] = cryptoOnly
    ? [cryptoOption]
    : [fiatOption, cryptoOption];

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
          Choose one of the options below to deposit crypto
        </Typography>
      </View>
      <ModalOptionsList options={receiveOptions} />
    </ActionModal>
  );
}
