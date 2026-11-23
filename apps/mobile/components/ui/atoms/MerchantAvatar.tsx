import React, { useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { cn } from "@/utils/cn";
import {
  resolveMerchantMark,
  type MerchantCategory,
} from "@/utils/merchantCategory";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const CATEGORY_MARKS: Record<
  MerchantCategory,
  { icon: IoniconName; tile: string; color: string }
> = {
  shopping: { icon: "bag-handle", tile: "bg-[#FDECF3]", color: "#D9437A" },
  food_drink: { icon: "restaurant", tile: "bg-[#FFF0E3]", color: "#E8741A" },
  groceries: { icon: "cart", tile: "bg-[#E7F6EC]", color: "#2B9856" },
  transport: { icon: "car", tile: "bg-[#E9F0FE]", color: "#3A6BDB" },
  travel: { icon: "airplane", tile: "bg-[#E3F4F8]", color: "#138DAD" },
  entertainment: { icon: "film", tile: "bg-[#F0EBFE]", color: "#7650E3" },
  health: { icon: "medkit", tile: "bg-[#FDECEC]", color: "#D94444" },
  services: { icon: "construct", tile: "bg-[#EDEFF2]", color: "#56606D" },
  bills: { icon: "receipt", tile: "bg-[#FFF5DB]", color: "#B87F00" },
  other: { icon: "storefront", tile: "bg-black/5", color: "#00000073" },
};

const GENERIC_MARK = CATEGORY_MARKS.other;

// Literal classes, because the Tailwind JIT cannot see a size built at runtime.
const SIZES = {
  40: { box: "size-[40px]", icon: 18 },
  64: { box: "size-[64px]", icon: 28 },
} as const;

interface MerchantAvatarProps {
  logoUrl?: string | null;
  category?: MerchantCategory | null;
  /** Matches the token disc it stands in for, so rows stay aligned. */
  size?: keyof typeof SIZES;
}

/**
 * Who was paid, Revolut style: the Merchant's logo when it loads, the icon
 * for what they sell when it does not, and a plain storefront otherwise.
 */
export function MerchantAvatar({
  logoUrl,
  category,
  size = 40,
}: MerchantAvatarProps) {
  // Keyed by URL so a recycled row showing another Merchant tries its logo
  // afresh instead of inheriting the last one's failure.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const mark = resolveMerchantMark({
    logoUrl,
    category,
    logoFailed: failedUri !== null && failedUri === logoUrl,
  });
  const { box, icon } = SIZES[size];

  if (mark.kind === "logo") {
    return (
      <View
        className={cn(
          "overflow-hidden rounded-full border border-black/[0.06] bg-white",
          box
        )}
      >
        <Image
          source={{ uri: mark.uri }}
          className="size-full"
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={mark.uri}
          transition={150}
          onError={() => setFailedUri(logoUrl ?? null)}
          accessibilityIgnoresInvertColors
        />
      </View>
    );
  }

  const style =
    mark.kind === "category" ? CATEGORY_MARKS[mark.category] : GENERIC_MARK;

  return (
    <View
      className={cn(
        "items-center justify-center rounded-full",
        style.tile,
        box
      )}
    >
      <Ionicons name={style.icon} size={icon} color={style.color} />
    </View>
  );
}
