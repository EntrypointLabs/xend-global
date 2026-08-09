import { useWindowDimensions } from "react-native";

/**
 * iPhone 14/15/16 logical height. The screens were drawn against this, so it is
 * the height at which every scaled length equals the value in the design.
 */
const REFERENCE_HEIGHT = 844;

/**
 * Below this the layout stops shrinking. Past roughly a quarter off, tap
 * targets and type start failing rather than merely looking tight, so a short
 * device is better served by clipping something than by scaling everything into
 * illegibility.
 */
const MIN_SCALE = 0.74;

/**
 * Proportional sizing for screens that have to fit without scrolling.
 *
 * Height rather than width: what runs out on a small phone is vertical room,
 * and scaling by width would shrink a narrow-but-tall device that has no
 * shortage of space.
 *
 * Never scales above 1. A taller phone gets more breathing room from the flex
 * layout, not larger type, because a headline that grows with the display reads
 * as a zoomed-in phone rather than a roomier one.
 */
export function useResponsiveLayout() {
  const { width, height } = useWindowDimensions();
  const scale = Math.min(1, Math.max(MIN_SCALE, height / REFERENCE_HEIGHT));

  return {
    width,
    height,
    scale,
    /**
     * A screen short enough that whitespace has to give before anything else.
     * A threshold rather than a curve: the choices it gates are discrete (drop a
     * margin, step a heading down), and the reference device must be untouched.
     */
    compact: height < 760,
    /** Scales a length taken from the reference layout. */
    size: (length: number) => Math.round(length * scale),
    /**
     * Scales type at half the rate of the boxes around it.
     *
     * Text set at full size inside a box shrunk to 74% reads as squeezed rather
     * than smaller, but scaling body copy 1:1 with the layout makes it illegible
     * on exactly the devices whose owners are most likely to need it larger.
     */
    typeSize: (length: number) => Math.round(length * (1 - (1 - scale) / 2)),
  };
}
