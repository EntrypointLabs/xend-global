import React from "react";
import { ActionModal } from "../ActionModal";
import { ModalOptionsList } from "../../molecules/ModalOptionsList";
import { ActionOption } from "../../molecules/ModalOptionsList";
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
}

export function ReceiveModal({
  visible,
  onClose,
  onOpenQRCode,
}: ReceiveModalProps) {
  const { accountInfo } = useAuth();
  const { hideAllModals } = useModalFlow();
  const {
    isBankLoading,
    getBankDescription,
    isBankDisabled,
    status,
    tosStatus,
  } = useKyc();

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

  const receiveOptions: ActionOption[] = [
    {
      key: "fiat",
      title: "Fiat",
      description: "Receive assets via bank Account",
      icon: bankIcon,
      onPress: handleReceiveFromBank,
      disabled: isBankDisabled,
    },
    {
      key: "crypto",
      title: "Crypto",
      description: "Receive assets via wallet address",
      icon: walletIcon,
      onPress: handleReceiveToWallet,
      disabled: accountInfo?.smart_account_address === null,
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
          Recieve
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
