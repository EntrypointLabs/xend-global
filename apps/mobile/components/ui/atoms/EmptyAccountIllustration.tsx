import React from "react";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";

const ASPECT = 160 / 240;

/**
 * What an Account that holds nothing shows where its assets will be listed: a
 * card, a tile with an empty slot, and one coin about to land in it.
 *
 * Decorative. The words beside it carry the meaning, so it is hidden from
 * screen readers. Source artwork: assets/images/empty-account.svg.
 */
export function EmptyAccountIllustration({ width = 210 }: { width?: number }) {
  return (
    <Svg
      width={width}
      height={width * ASPECT}
      viewBox="0 0 240 160"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <RadialGradient id="sh" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0.45" stopColor="#000000" stopOpacity="0.17" />
          <Stop offset="1" stopColor="#000000" stopOpacity="0" />
        </RadialGradient>
        <LinearGradient id="card" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#404040" />
          <Stop offset="1" stopColor="#0A0A0A" />
        </LinearGradient>
        <LinearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="1" stopColor="#E8E8E8" />
        </LinearGradient>
        <LinearGradient id="blue" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#66B5FF" />
          <Stop offset="1" stopColor="#0080FF" />
        </LinearGradient>
        <LinearGradient id="rim" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#D2D2D2" />
          <Stop offset="1" stopColor="#ABABAB" />
        </LinearGradient>
      </Defs>
      <G transform="translate(-11,-15.9) scale(1.18)">
        <Ellipse
          rx="76"
          ry="52"
          transform="matrix(0.87,-0.3,0.5,0.52,116,109)"
          fill="url(#sh)"
        />
        <Ellipse cx="55" cy="130" rx="26" ry="14" fill="url(#sh)" />
        <Rect
          x="-60"
          y="-38"
          width="120"
          height="76"
          rx="11"
          transform="matrix(0.87,-0.3,0.5,0.52,116,98)"
          fill="#3A3A3A"
        />
        <Rect
          x="-60"
          y="-38"
          width="120"
          height="76"
          rx="11"
          transform="matrix(0.87,-0.3,0.5,0.52,116,94)"
          fill="url(#card)"
        />
        <G transform="matrix(0.87,-0.3,0.5,0.52,116,94)">
          <Rect
            x="-46"
            y="-27"
            width="21"
            height="16"
            rx="4"
            fill="#FFFFFF"
            opacity="0.85"
          />
          <Rect
            x="-8"
            y="23"
            width="32"
            height="5"
            rx="2.5"
            fill="#FFFFFF"
            opacity="0.25"
          />
          <Rect
            x="30"
            y="23"
            width="14"
            height="5"
            rx="2.5"
            fill="#FFFFFF"
            opacity="0.25"
          />
        </G>
        <Rect
          x="-33"
          y="-33"
          width="66"
          height="66"
          rx="18"
          transform="matrix(0.87,-0.3,0.5,0.52,128.6,75.8)"
          fill="url(#rim)"
        />
        <Rect
          x="-33"
          y="-33"
          width="66"
          height="66"
          rx="18"
          transform="matrix(0.87,-0.3,0.5,0.52,128.6,68.8)"
          fill="url(#tile)"
        />
        <G transform="matrix(0.87,-0.3,0.5,0.52,128.6,68.8)">
          <Rect
            x="-33"
            y="-33"
            width="66"
            height="66"
            rx="18"
            fill="none"
            stroke="#0A0A0A"
            strokeWidth="0.8"
            opacity="0.14"
          />
          <Circle cx="-10" cy="-10" r="14" fill="#0A0A0A" opacity="0.12" />
          <Rect
            x="-22"
            y="10"
            width="32"
            height="6"
            rx="3"
            fill="#0A0A0A"
            opacity="0.16"
          />
          <Rect
            x="-22"
            y="21"
            width="18"
            height="5"
            rx="2.5"
            fill="#0A0A0A"
            opacity="0.08"
          />
        </G>
        <G transform="rotate(-16 114.9 35)">
          <Path d="M95.9 35v6a19 13 0 0 0 38 0v-6z" fill="#0062C4" />
          <Ellipse cx="114.9" cy="35" rx="19" ry="13" fill="url(#blue)" />
          <Ellipse
            cx="114.9"
            cy="35"
            rx="12.5"
            ry="8.5"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="1.6"
            opacity="0.55"
          />
        </G>
        <Path d="M36 115.5v11a19 11.4 0 0 0 38 0v-11z" fill="url(#rim)" />
        <Path
          d="M36.5 121a18.5 11.1 0 0 0 37 0"
          fill="none"
          stroke="#EDEDED"
          strokeWidth="1"
        />
        <Ellipse cx="55" cy="115.5" rx="19" ry="11.4" fill="url(#tile)" />
        <Ellipse
          cx="55"
          cy="115.5"
          rx="18.6"
          ry="11"
          fill="none"
          stroke="#0A0A0A"
          strokeWidth="0.8"
          opacity="0.14"
        />
        <Ellipse
          cx="55"
          cy="115.5"
          rx="12.5"
          ry="7.5"
          fill="none"
          stroke="#0A0A0A"
          strokeWidth="1.4"
          opacity="0.12"
        />
      </G>
    </Svg>
  );
}
