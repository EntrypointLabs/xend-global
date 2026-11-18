import React, { useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import { Image } from "expo-image";
import { BlurView } from "expo-blur";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from "react-native-svg";

import HapticPressable from "@/components/ui/atoms/HapticPressable";
import type { HomeWidget } from "@/utils/homeWidgets";

/**
 * Every length below is in points on a 436pt-wide card, measured off the Wise
 * UK card, and scaled by the real width at render. Text is placed by its cap
 * top rather than its line box so the scale never shifts the leading.
 */
const REF_WIDTH = 436;
const REF_HEIGHT = 367;
const INK = "#0E0F0C";

const CARD_RADIUS = 20;
const CLOSE = { size: 42, inset: 17, glyph: 12 };
const PILL = {
  top: 56.5,
  height: 36,
  flag: 28,
  padLeft: 4,
  gap: 10,
  padRight: 12,
  text: 16,
};
const TITLE = {
  size: 50,
  tracking: -1.5,
  pitch: 47,
  capHeight: 38,
  capMid: 152.5,
  inset: 20,
};
const BALANCE = { top: 213, size: 16 };
const DOCK = { inset: 13, top: 254, height: 100, radius: 18, padX: 8.5 };
const ACTION = { ring: 42, ringTop: 12, icon: 22, labelTop: 74, label: 13 };

/** Inter's vertical metrics, as fractions of the font size. */
const ASCENDER = 0.969;
const CAP_HEIGHT = 0.727;
const ASCENDER_GLYPH = 0.757;

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
  widget: HomeWidget;
  balanceLabel: string;
  onDismiss: () => void;
  onAction?: (action: CountryWidgetAction) => void;
}

export function CountryAccountWidget({
  widget,
  balanceLabel,
  onDismiss,
  onAction,
}: CountryAccountWidgetProps) {
  const [width, setWidth] = useState(0);
  const s = width / REF_WIDTH;
  const onLayout = (e: LayoutChangeEvent) =>
    setWidth(e.nativeEvent.layout.width);

  const titleLines = widget.displayName.split(" ");
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
            source={widget.background}
            style={FILL}
            contentFit="cover"
            transition={0}
          />
          <BottomHaze />

          <View
            accessible
            accessibilityLabel={`${widget.title}, ${balanceLabel} available to spend, ${widget.rateLabel}`}
            style={FILL}
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
              <View className="absolute inset-0 bg-black/10" />
              <Image
                source={widget.flagImage}
                style={{
                  width: PILL.flag * s,
                  height: PILL.flag * s,
                  borderRadius: (PILL.flag * s) / 2,
                }}
              />
              <Text
                className="font-inter-semibold text-white"
                style={{ fontSize: PILL.text * s, includeFontPadding: false }}
                numberOfLines={1}
                {...NO_SCALE}
              >
                {widget.rateLabel}
              </Text>
            </View>

            {titleLines.map((line, i) => (
              <Text
                key={`${line}-${i}`}
                className="absolute text-center text-white"
                style={{
                  top:
                    (firstCapTop +
                      i * TITLE.pitch -
                      (ASCENDER - CAP_HEIGHT) * TITLE.size) *
                    s,
                  left: TITLE.inset * s,
                  right: TITLE.inset * s,
                  fontFamily: "InterTight_900Black",
                  fontSize: TITLE.size * s,
                  letterSpacing: TITLE.tracking * s,
                  includeFontPadding: false,
                }}
                numberOfLines={1}
                adjustsFontSizeToFit
                {...NO_SCALE}
              >
                {line}
              </Text>
            ))}

            <Text
              className="absolute text-center font-inter-regular text-white"
              style={{
                left: TITLE.inset * s,
                right: TITLE.inset * s,
                textShadowColor: "rgba(0,0,0,0.25)",
                textShadowRadius: 6,
                top:
                  (BALANCE.top - (ASCENDER - ASCENDER_GLYPH) * BALANCE.size) *
                  s,
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

          <HapticPressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${widget.title} widget`}
            hitSlop={8}
            onPress={onDismiss}
            className="absolute items-center justify-center overflow-hidden rounded-full"
            style={{
              top: CLOSE.inset * s,
              right: CLOSE.inset * s,
              width: CLOSE.size * s,
              height: CLOSE.size * s,
            }}
          >
            <BlurView intensity={18} tint="light" style={FILL} />
            <View className="absolute inset-0 bg-white/10" />
            <CloseGlyph size={CLOSE.glyph * s} />
          </HapticPressable>

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
          <Stop offset="0.89" stopColor="#FFFFFF" stopOpacity={0.76} />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0.85} />
        </LinearGradient>
      </Defs>
      <Rect width={REF_WIDTH} height={REF_HEIGHT} fill="url(#haze)" />
    </Svg>
  );
}

function CloseGlyph({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12">
      <Path
        d="M1 1l10 10M11 1L1 11"
        stroke="#FFFFFF"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function PinIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 21.2s-6.2-5.6-6.2-11a6.2 6.2 0 0 1 12.4 0c0 5.4-6.2 11-6.2 11z"
        stroke={INK}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={10.2} r={2.4} stroke={INK} strokeWidth={2} />
    </Svg>
  );
}

function TagIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6.2 3.6h5.2l6.1 6.1-5.6 5.6-6.1-6.1V4.6a1 1 0 0 1 .4-1z"
        stroke={INK}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Circle cx={8.9} cy={6.6} r={1.2} fill={INK} />
      <Path
        d="M4 13.2l7.9 7.9 8.4-8.4"
        stroke={INK}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function SplitIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={1} y={5} width={15} height={11.5} rx={1.8} fill={INK} />
      <Rect
        x={7.5}
        y={7.5}
        width={15.5}
        height={11.5}
        rx={1.8}
        fill={INK}
        stroke="#FFFFFF"
        strokeWidth={1.5}
      />
      <Path
        d="M17.6 11.4a3.2 3.2 0 0 0-5.6 1M12.9 15.1a3.2 3.2 0 0 0 5.6-1"
        stroke="#FFFFFF"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <Path
        d="M17.9 9.6v2h-2M12.6 16.9v-2h2"
        stroke="#FFFFFF"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function MoreIcon({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={6.5} cy={12} r={1.7} fill={INK} />
      <Circle cx={12} cy={12} r={1.7} fill={INK} />
      <Circle cx={17.5} cy={12} r={1.7} fill={INK} />
    </Svg>
  );
}
