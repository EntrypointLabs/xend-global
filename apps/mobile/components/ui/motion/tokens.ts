import { Easing } from "react-native-reanimated";

/** Decelerates hard and settles without a bounce: things arrive, they do not land. */
export const EASE_OUT = Easing.bezier(0.2, 0.8, 0.2, 1);

export const RISE = {
  distance: 14,
  duration: 420,
  stagger: 45,
} as const;

export const POP = {
  fromScale: 0.5,
  fadeMs: 160,
  /** Critically damped: it arrives fast and stops, with no bounce. */
  spring: { damping: 30, stiffness: 240, mass: 0.9 },
} as const;

export const ROLL = {
  duration: 340,
  stagger: 22,
  /** Share of the glyph's height a digit travels as it rolls in or out. */
  travel: 0.45,
} as const;
