import { View } from "react-native";
import React from "react";
import { Typography, TypographyProps } from "./ui/atoms/Typography";
import { cn } from "@/utils/class";
import { useOnPhoto } from "./ui/glass";

type BalanceViewProps = TypographyProps & {
  amount: string;
};

const BalanceView = ({ amount, ...props }: BalanceViewProps) => {
  const onPhoto = useOnPhoto();
  const [integerPart, decimalPart] = amount.split(".");
  return (
    <View className="flex-row items-baseline">
      <Typography {...props}>${integerPart}.</Typography>
      <Typography
        {...props}
        className={cn(
          props.className,
          onPhoto ? "text-white/[0.56]" : "text-black/30"
        )}
      >
        {decimalPart || "00"}
      </Typography>
    </View>
  );
};

export default BalanceView;
