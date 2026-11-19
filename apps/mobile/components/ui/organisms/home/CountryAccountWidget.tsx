import React, { useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { Image } from "expo-image";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from "react-native-svg";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import type { CountryCard } from "@/utils/countryCards";

/**
 * Every length below is in points on a 436pt-wide card, measured off the Wise
 * UK card, and scaled by the real width at render. Text is placed by its cap
 * top rather than its line box so the scale never shifts the leading.
 */
const REF_WIDTH = 436;
const REF_HEIGHT = 367;
const INK = "#0E0F0C";
const PAPER = "#FAFBF8";

const CARD_RADIUS = 20;
const PILL = {
  top: 55.5,
  height: 37,
  flag: 24.5,
  padLeft: 6.75,
  gap: 10.25,
  padRight: 6.5,
  text: 16.8,
};
/**
 * Montserrat is the PRYDD wordmark face. Wise's title face is narrower, so each
 * line is condensed horizontally to the width the catalog gives it; `condense`
 * covers lines it gives no width for.
 */
const TITLE = {
  capHeight: 38.75,
  tracking: -0.06,
  condense: 0.86,
  pitch: 48,
  capMid: 152.5,
  inset: 20,
};
const BALANCE = { top: 212.5, size: 16.65 };
const DOCK = { inset: 13, top: 253, height: 101, radius: 18, padX: 8.5 };
const ACTION = {
  ring: 42,
  ringTop: 12.75,
  icon: 22,
  labelTop: 73.5,
  label: 13,
};

/** Vertical metrics, as fractions of the font size. */
const ASCENDER = 0.969;
const CAP_HEIGHT = 0.727;
const ASCENDER_GLYPH = 0.757;
const TITLE_ASCENDER = 0.968;
const TITLE_CAP_HEIGHT = 0.7;
const TITLE_SIZE = TITLE.capHeight / TITLE_CAP_HEIGHT;
/**
 * iOS lays letter-spacing after the last glyph too, which pushes a centred line
 * right by half of it; the line box is shifted back by that much.
 */
const TRAILING = (TITLE.tracking * TITLE_SIZE) / 2;

/**
 * The card is fixed geometry, so text keeps to the measured layout instead of
 * growing with Dynamic Type; the whole card is still read out as one label.
 */
const NO_SCALE = { allowFontScaling: false } as const;

const FILL = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
} as const;

const ACTIONS = [
  { key: "atm", label: "Find an ATM", Icon: PinIcon },
  { key: "convert", label: "Convert price", Icon: TagIcon },
  { key: "split", label: "Split a bill", Icon: SplitIcon },
  { key: "more", label: "Do more", Icon: MoreIcon },
] as const;

export type CountryWidgetAction = (typeof ACTIONS)[number]["key"];

interface CountryAccountWidgetProps {
  card: CountryCard;
  balanceLabel: string;
  rateLabel: string;
  onAction?: (action: CountryWidgetAction) => void;
}

export function CountryAccountWidget({
  card,
  balanceLabel,
  rateLabel,
  onAction,
}: CountryAccountWidgetProps) {
  const [width, setWidth] = useState(0);
  const s = width / REF_WIDTH;
  const onLayout = (e: LayoutChangeEvent) =>
    setWidth(e.nativeEvent.layout.width);

  const titleLines = card.lines;
  const [natural, setNatural] = useState<Record<number, number>>({});
  const condenseFor = (i: number) => {
    const target = card.titleWidths?.[i];
    const measured = natural[i];
    return target && measured ? (target * s) / measured : TITLE.condense;
  };
  const titleBlock = (titleLines.length - 1) * TITLE.pitch + TITLE.capHeight;
  const firstCapTop = TITLE.capMid - titleBlock / 2;

  return (
    <View
      onLayout={onLayout}
      className="w-full overflow-hidden bg-neutral-500"
      style={{
        aspectRatio: REF_WIDTH / REF_HEIGHT,
        borderRadius: CARD_RADIUS * s,
      }}
    >
      {width > 0 && (
        <>
          <Image
            source={{ uri: card.photoUrl }}
            style={FILL}
            contentFit="cover"
            transition={0}
          />
          <BottomHaze />

          {/* Read as one element, but only over the area above the dock:
          stretched over the whole card it overlapped the dock's buttons, and
          VoiceOver's touch exploration could land on the card instead. */}
          <View
            accessible
            accessibilityLabel={`${card.name}, ${balanceLabel} available to spend, ${rateLabel}`}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: DOCK.top * s,
            }}
          >
            <View
              className="absolute flex-row items-center self-center overflow-hidden rounded-full"
              style={{
                top: PILL.top * s,
                height: PILL.height * s,
                paddingLeft: PILL.padLeft * s,
                paddingRight: PILL.padRight * s,
                gap: PILL.gap * s,
              }}
            >
              <BlurView intensity={18} tint="dark" style={FILL} />
              <View className="absolute inset-0 bg-black/[0.15]" />
              {card.flagUrl ? (
                <Image
                  source={{ uri: card.flagUrl }}
                  style={{
                    width: PILL.flag * s,
                    height: PILL.flag * s,
                    borderRadius: (PILL.flag * s) / 2,
                  }}
                />
              ) : (
                <Ionicons
                  name="globe-outline"
                  size={PILL.flag * s}
                  color={PAPER}
                />
              )}
              <Text
                className="font-inter-semibold"
                style={{
                  color: PAPER,
                  fontSize: PILL.text * s,
                  includeFontPadding: false,
                }}
                numberOfLines={1}
                {...NO_SCALE}
              >
                {rateLabel}
              </Text>
            </View>

            {titleLines.map((line, i) => (
              <Text
                key={`${line}-${i}`}
                className="absolute text-center"
                style={{
                  top:
                    (firstCapTop +
                      i * TITLE.pitch -
                      (TITLE_ASCENDER - TITLE_CAP_HEIGHT) * TITLE_SIZE) *
                    s,
                  left: (TITLE.inset + TRAILING * condenseFor(i)) * s,
                  right: (TITLE.inset - TRAILING * condenseFor(i)) * s,
                  color: PAPER,
                  fontFamily: "Montserrat_900Black",
                  fontSize: TITLE_SIZE * s,
                  letterSpacing: TITLE.tracking * TITLE_SIZE * s,
                  includeFontPadding: false,
                  transform: [{ scaleX: condenseFor(i) }],
                }}
                onTextLayout={(e) => {
                  const lineWidth = e.nativeEvent.lines[0]?.width;
                  if (lineWidth && lineWidth !== natural[i]) {
                    setNatural((prev) => ({ ...prev, [i]: lineWidth }));
                  }
                }}
                numberOfLines={1}
                adjustsFontSizeToFit
                {...NO_SCALE}
              >
                {line}
              </Text>
            ))}

            <Text
              className="absolute text-center font-inter-regular"
              style={{
                left: TITLE.inset * s,
                right: TITLE.inset * s,
                textShadowColor: "rgba(0,0,0,0.25)",
                textShadowRadius: 6,
                top:
                  (BALANCE.top - (ASCENDER - ASCENDER_GLYPH) * BALANCE.size) *
                  s,
                color: PAPER,
                fontSize: BALANCE.size * s,
                includeFontPadding: false,
              }}
              numberOfLines={1}
              adjustsFontSizeToFit
              {...NO_SCALE}
            >
              <Text className="font-inter-semibold">{balanceLabel}</Text>
              {" available to spend"}
            </Text>
          </View>

          <View
            className="absolute flex-row bg-white"
            style={{
              left: DOCK.inset * s,
              right: DOCK.inset * s,
              top: DOCK.top * s,
              height: DOCK.height * s,
              borderRadius: DOCK.radius * s,
              paddingHorizontal: DOCK.padX * s,
            }}
          >
            {ACTIONS.map(({ key, label, Icon }) => (
              <HapticPressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ disabled: !onAction }}
                disabled={!onAction}
                onPress={() => onAction?.(key)}
                className="flex-1 items-center"
              >
                <View
                  className="items-center justify-center rounded-full border border-black/10"
                  style={{
                    marginTop: ACTION.ringTop * s,
                    width: ACTION.ring * s,
                    height: ACTION.ring * s,
                  }}
                >
                  <Icon size={ACTION.icon * s} />
                </View>
                <Text
                  className="absolute left-0 right-0 text-center font-inter-semibold"
                  style={{
                    top:
                      (ACTION.labelTop -
                        (ASCENDER - CAP_HEIGHT) * ACTION.label) *
                      s,
                    color: INK,
                    fontSize: ACTION.label * s,
                    includeFontPadding: false,
                  }}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  {...NO_SCALE}
                >
                  {label}
                </Text>
              </HapticPressable>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

/** The photo lifts toward white behind the dock, as Wise's does. */
function BottomHaze() {
  return (
    <Svg
      width="100%"
      height="100%"
      preserveAspectRatio="none"
      viewBox={`0 0 ${REF_WIDTH} ${REF_HEIGHT}`}
      style={{ position: "absolute" }}
    >
      <Defs>
        <LinearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0.55" stopColor="#FFFFFF" stopOpacity={0} />
          <Stop offset="0.66" stopColor="#FFFFFF" stopOpacity={0.27} />
          <Stop offset="0.89" stopColor="#FFFFFF" stopOpacity={0.7} />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0.78} />
        </LinearGradient>
      </Defs>
      <Rect width={REF_WIDTH} height={REF_HEIGHT} fill="url(#haze)" />
    </Svg>
  );
}

const STROKE = 2.3;

function PinIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 20.4l-4.05-5.97a6.3 6.3 0 1 1 8.1 0z"
        stroke={INK}
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={9.6} r={2.5} stroke={INK} strokeWidth={STROKE} />
    </Svg>
  );
}

function TagIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 3.3h5.6l6.4 6.4-5.9 5.9-6.4-6.4V4.6a1.3 1.3 0 0 1 .3-1.3z"
        stroke={INK}
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
      <Circle cx={8.9} cy={6.5} r={1.25} fill={INK} />
      <Path
        d="M3.6 13.4l8.2 8 8.6-8.5"
        stroke={INK}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** A banknote cut in two, the halves offset, with the swap arrows between. */
function SplitIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        fillRule="evenodd"
        d="M3.8 4.4h7.4v3H5.2v7.2h3.5v3H3.8a1.6 1.6 0 0 1-1.6-1.6V6a1.6 1.6 0 0 1 1.6-1.6z"
        fill={INK}
      />
      <Path
        fillRule="evenodd"
        d="M20.2 19.6h-7.4v-3h6v-7.2h-3.5v-3h4.9a1.6 1.6 0 0 1 1.6 1.6V18a1.6 1.6 0 0 1-1.6 1.6z"
        fill={INK}
      />
      <Path
        d="M15 9.6a3.4 3.4 0 0 0-5.9 1.9M9 14.4a3.4 3.4 0 0 0 5.9-1.9"
        stroke={INK}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function MoreIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={5.3} cy={12} r={1.9} fill={INK} />
      <Circle cx={12} cy={12} r={1.9} fill={INK} />
      <Circle cx={18.7} cy={12} r={1.9} fill={INK} />
    </Svg>
  );
}
