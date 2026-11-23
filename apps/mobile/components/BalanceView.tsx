import { View } from "react-native";
import React from "react";
import { Typography, TypographyProps } from "./ui/atoms/Typography";
import { RollingText } from "./ui/motion/RollingText";
import { cn } from "@/utils/class";
import { useOnPhoto } from "./ui/glass";

type BalanceViewProps = TypographyProps & {
  amount: string;
  /** Rolls the digits in on arrival, and the changed ones on every update. */
  rolling?: boolean;
};

const BalanceView = ({
  amount,
  rolling = false,
  ...props
}: BalanceViewProps) => {
  const onPhoto = useOnPhoto();
  const [integerPart, decimalPart] = amount.split(".");
  const decimalClassName = cn(
    props.className,
    onPhoto ? "text-white/[0.56]" : "text-foreground/30"
  );
  if (rolling) {
    return (
      <View
        className="flex-row items-baseline"
        accessible
        accessibilityLabel={`$${amount}`}
      >
        <RollingText {...props} text={`$${integerPart}.`} />
        <RollingText
          {...props}
          className={decimalClassName}
          startAt={integerPart.length + 2}
          text={decimalPart || "00"}
        />
      </View>
    );
  }
  return (
    <View className="flex-row items-baseline">
      <Typography {...props}>${integerPart}.</Typography>
      <Typography {...props} className={decimalClassName}>
        {decimalPart || "00"}
      </Typography>
    </View>
  );
};

export default BalanceView;
