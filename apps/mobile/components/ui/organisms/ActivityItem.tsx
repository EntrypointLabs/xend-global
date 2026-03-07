import {
  View,
  Image,
  TouchableOpacity,
  ImageSourcePropType,
} from "react-native";
import { Typography } from "../atoms/Typography";
import { History } from "@/types/History";
import { truncateAddress } from "@/utils/helper";
import { formatAmount } from "@/utils/solana";
import HapticPressable from "../atoms/HapticPressable";

export type ActivityItemProps = History & {
  onPress?: () => void;
};

export function ActivityItem({ onPress, ...data }: ActivityItemProps) {
  const positiveColor = "#34C759"; // Green
  const negativeColor = "#FF3B30"; // Red

  const isHidden = false;

  const displayAmount = isHidden
    ? "****"
    : formatAmount(data.amount, data.token.decimal);
  const displaySign = isHidden ? "" : data.side === "send" ? "-" : "+";
  const valueColor = isHidden
    ? undefined
    : data.side === "send"
      ? negativeColor
      : positiveColor;
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
          className="text-sm tracking-[0.5px]"
          style={{ color: valueColor }}
        >
          {displaySign}
          {displayAmount} {data.token.symbol}
        </Typography>
      </View>
    </HapticPressable>
  );
}
