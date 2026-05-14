import React from "react";
import { View, Image, ImageSourcePropType } from "react-native";

interface OverlappingImagesProps {
  leftImage: ImageSourcePropType;
  rightImage: ImageSourcePropType;
  size?: number;
  overlap?: number;
  borderWidth?: number;
  borderColor?: string;
  leftOnTop?: boolean;
  backdropOpacity?: number;
}

export function OverlappingImages({
  leftImage,
  rightImage,
  size = 40,
  overlap = 0.3,
  borderWidth = 0,
  borderColor = "white",
  leftOnTop = true,
  backdropOpacity = 1,
}: OverlappingImagesProps) {
  const overlapValue = size * overlap;
  const leftZIndex = leftOnTop ? 2 : 1;
  const rightZIndex = leftOnTop ? 1 : 2;
  const leftOpacity = leftOnTop ? 1 : backdropOpacity;
  const rightOpacity = leftOnTop ? backdropOpacity : 1;

  return (
    <View
      className="flex-row items-center"
      // MEASURED-LAYOUT (size/overlap props)
      style={{ width: size * 2 - overlapValue }}
    >
      <View
        className="overflow-hidden"
        // MEASURED-LAYOUT
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth,
          borderColor,
          zIndex: leftZIndex,
          opacity: leftOpacity,
        }}
      >
        <Image
          source={leftImage}
          // MEASURED-LAYOUT
          style={{ width: size, height: size, borderRadius: size / 2 }}
          resizeMode="cover"
        />
      </View>

      <View
        className="overflow-hidden"
        // MEASURED-LAYOUT
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth,
          borderColor,
          marginLeft: -overlapValue,
          zIndex: rightZIndex,
          opacity: rightOpacity,
        }}
      >
        <Image
          source={rightImage}
          // MEASURED-LAYOUT
          style={{ width: size, height: size, borderRadius: size / 2 }}
          resizeMode="cover"
        />
      </View>
    </View>
  );
}
