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

import {
  cardInk,
  EmptyAccountIllustration,
} from "@/components/ui/atoms/EmptyAccountIllustration";
import { usePalette } from "@/hooks/usePalette";

export type StatusScene =
  | "empty-account"
  | "earn"
  | "bank"
  | "clock"
  | "passkey"
  | "payment"
  | "phone";

const ASPECT = 160 / 240;
const INK = "#0A0A0A";

/** The tilt every scene shares with the empty-account artwork. */
const iso = (x: number, y: number) => `matrix(0.87,-0.3,0.5,0.52,${x},${y})`;

/**
 * Small isometric scenes in the same family as the empty-account artwork: a
 * white tile on a grey rim, a dark card, and one blue coin as the accent.
 *
 * Decorative. The words beside them carry the meaning, so they are hidden from
 * screen readers.
 */
export function StatusIllustration({
  scene,
  width,
}: {
  scene: StatusScene;
  width: number;
}) {
  const palette = usePalette();
  if (scene === "empty-account") {
    return <EmptyAccountIllustration width={width} />;
  }
  // Gradient ids are document-wide on some platforms, so each scene gets its own.
  const id = (name: string) => `${scene}-${name}`;
  const card = cardInk(palette.dark);
  return (
    <Svg
      width={width}
      height={width * ASPECT}
      viewBox="0 0 240 160"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <RadialGradient id={id("sh")} cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0.45" stopColor="#000000" stopOpacity="0.17" />
          <Stop offset="1" stopColor="#000000" stopOpacity="0" />
        </RadialGradient>
        <LinearGradient id={id("card")} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={card.from} />
          <Stop offset="1" stopColor={card.to} />
        </LinearGradient>
        <LinearGradient id={id("tile")} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="1" stopColor="#E8E8E8" />
        </LinearGradient>
        <LinearGradient id={id("blue")} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#66B5FF" />
          <Stop offset="1" stopColor="#0080FF" />
        </LinearGradient>
        <LinearGradient id={id("rim")} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#D2D2D2" />
          <Stop offset="1" stopColor="#ABABAB" />
        </LinearGradient>
      </Defs>
      <G transform="translate(-11,-15.9) scale(1.18)">
        <Scene scene={scene} id={id} />
      </G>
    </Svg>
  );
}

type Id = (name: string) => string;

function Scene({ scene, id }: { scene: StatusScene; id: Id }) {
  const card = cardInk(usePalette().dark);
  switch (scene) {
    case "earn":
      return (
        <>
          <Shadow x={118} y={110} rx={78} ry={50} id={id} />
          <Tile x={124} y={86} id={id}>
            <Rect
              x="-20"
              y="2"
              width="9"
              height="16"
              rx="3"
              fill={INK}
              opacity="0.12"
            />
            <Rect
              x="-6"
              y="-8"
              width="9"
              height="26"
              rx="3"
              fill={INK}
              opacity="0.16"
            />
            <Rect
              x="8"
              y="-20"
              width="9"
              height="38"
              rx="3"
              fill={`url(#${id("blue")})`}
            />
          </Tile>
          <WhiteCoin x={74} y={120} id={id} />
          <WhiteCoin x={74} y={110} id={id} />
          <WhiteCoin x={74} y={100} id={id} />
          <BlueCoin x={130} y={38} id={id} />
        </>
      );
    case "bank":
      return (
        <>
          <Shadow x={116} y={110} rx={78} ry={52} id={id} />
          <DarkCard x={100} y={104} id={id} />
          <Tile x={140} y={70} id={id}>
            <Path d="M-22 -6 L0 -22 L22 -6 Z" fill={INK} opacity="0.16" />
            <Rect
              x="-18"
              y="-2"
              width="6"
              height="18"
              rx="2"
              fill={INK}
              opacity="0.12"
            />
            <Rect
              x="-3"
              y="-2"
              width="6"
              height="18"
              rx="2"
              fill={INK}
              opacity="0.12"
            />
            <Rect
              x="12"
              y="-2"
              width="6"
              height="18"
              rx="2"
              fill={INK}
              opacity="0.12"
            />
            <Rect
              x="-22"
              y="19"
              width="44"
              height="5"
              rx="2.5"
              fill={INK}
              opacity="0.16"
            />
          </Tile>
          <BlueCoin x={76} y={44} id={id} />
        </>
      );
    case "clock":
      return (
        <>
          <Shadow x={118} y={110} rx={74} ry={50} id={id} />
          <DarkCard x={96} y={108} id={id} />
          <Tile x={136} y={74} id={id}>
            <Circle
              r="21"
              fill="none"
              stroke={INK}
              strokeWidth="2.4"
              opacity="0.18"
            />
            <Path
              d="M0 0 V-13 M0 0 L10 6"
              stroke={`url(#${id("blue")})`}
              strokeWidth="4"
              strokeLinecap="round"
            />
            <Circle r="3" fill={INK} opacity="0.4" />
          </Tile>
          <WhiteCoin x={52} y={124} id={id} />
        </>
      );
    case "passkey":
      return (
        <>
          <Shadow x={116} y={110} rx={78} ry={52} id={id} />
          <DarkCard x={98} y={106} id={id} />
          <Tile x={138} y={72} id={id}>
            {[8, 14, 20, 26].map((r, i) => (
              <Path
                key={r}
                d={`M${-r} 6 A${r} ${r} 0 0 1 ${r} 6`}
                fill="none"
                stroke={i === 1 ? `url(#${id("blue")})` : INK}
                strokeWidth="2.6"
                strokeLinecap="round"
                opacity={i === 1 ? 1 : 0.16}
              />
            ))}
            <Path
              d="M0 0 V18"
              stroke={INK}
              strokeWidth="2.6"
              strokeLinecap="round"
              opacity="0.16"
            />
          </Tile>
          <WhiteCoin x={52} y={124} id={id} />
          <BlueCoin x={78} y={44} id={id} />
        </>
      );
    case "payment":
      return (
        <>
          <Shadow x={116} y={110} rx={78} ry={52} id={id} />
          <DarkCard x={104} y={104} id={id} />
          <Tile x={142} y={70} id={id}>
            <Rect
              x="-20"
              y="-18"
              width="40"
              height="6"
              rx="3"
              fill={INK}
              opacity="0.16"
            />
            <Rect
              x="-20"
              y="-6"
              width="28"
              height="5"
              rx="2.5"
              fill={INK}
              opacity="0.1"
            />
            <Rect
              x="-20"
              y="4"
              width="34"
              height="5"
              rx="2.5"
              fill={INK}
              opacity="0.1"
            />
            <Rect
              x="-20"
              y="16"
              width="40"
              height="7"
              rx="3.5"
              fill={`url(#${id("blue")})`}
            />
          </Tile>
          <BlueCoin x={74} y={42} id={id} />
        </>
      );
    case "phone":
      return (
        <>
          <Shadow x={118} y={112} rx={70} ry={48} id={id} />
          <G transform="translate(120 96) scale(1.25) translate(-120 -96)">
            <Rect
              x="-26"
              y="-46"
              width="52"
              height="92"
              rx="12"
              transform={iso(120, 98)}
              fill={card.edge}
            />
            <Rect
              x="-26"
              y="-46"
              width="52"
              height="92"
              rx="12"
              transform={iso(120, 93)}
              fill={`url(#${id("card")})`}
            />
            <G transform={iso(120, 93)}>
              <Rect
                x="-21"
                y="-40"
                width="42"
                height="80"
                rx="8"
                fill={`url(#${id("tile")})`}
              />
              <Circle cx="0" cy="-8" r="10" fill={INK} opacity="0.12" />
              <Rect
                x="-13"
                y="10"
                width="26"
                height="5"
                rx="2.5"
                fill={INK}
                opacity="0.16"
              />
              <Rect
                x="-9"
                y="20"
                width="18"
                height="4"
                rx="2"
                fill={INK}
                opacity="0.08"
              />
            </G>
          </G>
          <BlueCoin x={164} y={38} id={id} />
          <WhiteCoin x={58} y={126} id={id} />
        </>
      );
    default:
      return null;
  }
}

function Shadow({
  x,
  y,
  rx,
  ry,
  id,
}: {
  x: number;
  y: number;
  rx: number;
  ry: number;
  id: Id;
}) {
  return (
    <Ellipse
      rx={rx}
      ry={ry}
      transform={`matrix(0.87,-0.3,0.5,0.52,${x},${y})`}
      fill={`url(#${id("sh")})`}
    />
  );
}

function Tile({
  x,
  y,
  id,
  children,
}: {
  x: number;
  y: number;
  id: Id;
  children: React.ReactNode;
}) {
  return (
    <>
      <Rect
        x="-33"
        y="-33"
        width="66"
        height="66"
        rx="18"
        transform={iso(x, y + 7)}
        fill={`url(#${id("rim")})`}
      />
      <Rect
        x="-33"
        y="-33"
        width="66"
        height="66"
        rx="18"
        transform={iso(x, y)}
        fill={`url(#${id("tile")})`}
      />
      <G transform={iso(x, y)}>
        <Rect
          x="-33"
          y="-33"
          width="66"
          height="66"
          rx="18"
          fill="none"
          stroke={INK}
          strokeWidth="0.8"
          opacity="0.14"
        />
        {children}
      </G>
    </>
  );
}

function DarkCard({ x, y, id }: { x: number; y: number; id: Id }) {
  const card = cardInk(usePalette().dark);
  return (
    <>
      <Rect
        x="-60"
        y="-38"
        width="120"
        height="76"
        rx="11"
        transform={iso(x, y + 4)}
        fill={card.edge}
      />
      <Rect
        x="-60"
        y="-38"
        width="120"
        height="76"
        rx="11"
        transform={iso(x, y)}
        fill={`url(#${id("card")})`}
      />
      <G transform={iso(x, y)}>
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
    </>
  );
}

function BlueCoin({ x, y, id }: { x: number; y: number; id: Id }) {
  return (
    <G transform={`rotate(-16 ${x} ${y})`}>
      <Path d={`M${x - 19} ${y}v6a19 13 0 0 0 38 0v-6z`} fill="#0062C4" />
      <Ellipse cx={x} cy={y} rx="19" ry="13" fill={`url(#${id("blue")})`} />
      <Ellipse
        cx={x}
        cy={y}
        rx="12.5"
        ry="8.5"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="1.6"
        opacity="0.55"
      />
    </G>
  );
}

function WhiteCoin({ x, y, id }: { x: number; y: number; id: Id }) {
  return (
    <>
      <Path
        d={`M${x - 19} ${y}v8a19 11.4 0 0 0 38 0v-8z`}
        fill={`url(#${id("rim")})`}
      />
      <Ellipse cx={x} cy={y} rx="19" ry="11.4" fill={`url(#${id("tile")})`} />
      <Ellipse
        cx={x}
        cy={y}
        rx="18.6"
        ry="11"
        fill="none"
        stroke={INK}
        strokeWidth="0.8"
        opacity="0.14"
      />
      <Ellipse
        cx={x}
        cy={y}
        rx="12.5"
        ry="7.5"
        fill="none"
        stroke={INK}
        strokeWidth="1.4"
        opacity="0.12"
      />
    </>
  );
}
