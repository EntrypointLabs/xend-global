import { View, Image, ImageSourcePropType } from "react-native";
import { Typography } from "../atoms/Typography";
import { History } from "@/types/History";
import { truncateAddress } from "@/utils/helper";
import { formatAmount } from "@/utils/solana";
import HapticPressable from "../atoms/HapticPressable";
import { cn } from "@/utils/cn";

export type ActivityItemProps = History & {
  onPress?: () => void;
};

export function ActivityItem({ onPress, ...data }: ActivityItemProps) {
  const isHidden = false;

  const displayAmount = isHidden
    ? "****"
    : formatAmount(data.amount, data.token.decimal);
  const displaySign = isHidden ? "" : data.side === "send" ? "-" : "+";
  const valueColorClass = isHidden
    ? ""
    : data.side === "send"
      ? "text-destructive"
      : "text-success";
  const label =
    data.side === "send"
      ? `To: ${truncateAddress(data.to)}`
      : `From: ${truncateAddress(data.from)}`;

  return (
    <HapticPressable
      className="flex-row items-center gap-3.5 py-3"
      onPress={onPress}
    >
      <Image
        source={data.token.icon as ImageSourcePropType}
        className="size-10 rounded-full"
      />
      <View className="flex-1 flex-row items-center justify-between">
        <View className="flex-col">
          <Typography weight="600" className="mb-0.5">
            {data.token.name}
          </Typography>
          <Typography weight="500" className="text-sm text-black/30">
            {label}
          </Typography>
        </View>
        <Typography
          weight="600"
          className={cn("text-sm tracking-[0.5px]", valueColorClass)}
        >
          {displaySign}
          {displayAmount} {data.token.symbol}
        </Typography>
      </View>
    </HapticPressable>
  );
}
