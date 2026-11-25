import { createContext, useContext } from "react";
import {
  type StyleProp,
  useWindowDimensions,
  type ViewStyle,
} from "react-native";
import {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";

/** How small a sheet gets while another sheet sits on top of it. */
const COVERED_SCALE = 0.93;

/** How much of a covered sheet's top edge stays in view above the one over it. */
const COVERED_PEEK = 8;

/** The corners sheets in a stack share, so the layers read as one set. */
export const STACKED_CORNERS: ViewStyle = {
  borderTopLeftRadius: 34,
  borderTopRightRadius: 34,
};

/**
 * Layers within a stack. The sheets render side by side through a portal, so
 * the order has to be stated: the covered sheet, the wash that sets it back,
 * then the sheet on top.
 */
export const SHEET_LAYER = {
  covered: { zIndex: 1 },
  wash: { zIndex: 2 },
  covering: { zIndex: 3 },
} satisfies Record<string, ViewStyle>;

/** The scale reads from the top of the screen, which the sheet's container spans. */
const FROM_SCREEN_TOP: ViewStyle = { transformOrigin: "50% 0%" };

interface CoveringSheet {
  index: SharedValue<number>;
  position: SharedValue<number>;
}

const CoveringSheetContext = createContext<CoveringSheet | undefined>(
  undefined
);

/**
 * For a sheet other sheets open over. Pass `ownPosition` as the sheet's
 * `animatedPosition` and `coveredStyle` on its `containerStyle`, and wrap the
 * sheets that open over it in `SheetStackProvider` with `stack`.
 *
 * As a sheet rises over this one, this one shrinks and settles with its top
 * just above the other's, and follows it back when it is dragged away.
 */
export function useSheetStack() {
  const { height: screenHeight } = useWindowDimensions();
  const ownPosition = useSharedValue(0);
  const index = useSharedValue(-1);
  const position = useSharedValue(screenHeight);

  const motion = useAnimatedStyle(() => {
    const progress = interpolate(
      index.value,
      [-1, 0],
      [0, 1],
      Extrapolation.CLAMP
    );
    if (progress === 0) return { transform: [{ translateY: 0 }, { scale: 1 }] };
    const scale = interpolate(progress, [0, 1], [1, COVERED_SCALE]);
    // The covering sheet's top moves in step with its index, so where it will
    // rest is known from where it is now. Scaled toward the target by the same
    // progress, the covered sheet arrives exactly as the other one settles.
    const coveringTravel = screenHeight - position.value;
    const settle =
      progress * (screenHeight - COVERED_PEEK) -
      coveringTravel -
      progress * ownPosition.value * scale;
    return {
      transform: [{ translateY: settle }, { scale }],
    };
  });

  return {
    stack: { index, position } satisfies CoveringSheet,
    ownPosition,
    coveredStyle: [FROM_SCREEN_TOP, motion] as StyleProp<ViewStyle>,
  };
}

export const SheetStackProvider = CoveringSheetContext.Provider;

/**
 * For a sheet that opens over another. Spread `sheetProps` onto the sheet;
 * `stacked` says whether there is a sheet underneath.
 */
export function useCoveringSheet() {
  const covering = useContext(CoveringSheetContext);
  return {
    stacked: covering !== undefined,
    sheetProps: covering
      ? { animatedIndex: covering.index, animatedPosition: covering.position }
      : {},
  };
}
