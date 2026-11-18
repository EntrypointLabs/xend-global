import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import { cn } from "@/utils/cn";

export interface ActionPillItem {
  icon: React.FC<{
    isActive?: boolean;
    size?: number;
    tone?: "dark" | "light";
  }>;
  label?: string;
  onPress: () => void;
  onLongPress?: () => void;
  isActive?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

export interface ActionPillProps {
  items: ActionPillItem[];
  containerStyle?: StyleProp<ViewStyle>;
  /**
   * `glass` is the prydd.co card material for screens on the photo: a 10%
   * white fill and an 18% white hairline. It adds a dark blur the site's
   * static cards do not need, because this one floats over scrolling content
   * and the icons must stay legible whatever passes under it.
   */
  variant?: "solid" | "glass";
  /** iOS 26 liquid glass where the system has it; for floating chrome. */
  liquid?: boolean;
  /** Folded to the active item alone; tapping it calls `onExpand`. */
  collapsed?: boolean;
  onExpand?: () => void;
}

const SOLID_SHADOW = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.1,
  shadowRadius: 16,
  elevation: 6,
};

/** Lifts clear glass off a white screen, where it would otherwise vanish. */
const LIQUID_SHADOW = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 12,
};

/** iOS 26's own material. Older systems and Android keep the drawn one. */
const LIQUID_AVAILABLE = isLiquidGlassAvailable();

/** A foldable pill's slot per tab, and its height and folded diameter. */
const SLOT = 56;
const FOLDED = 50;
/** Long and eased out, so the glass settles into the circle rather than snapping. */
const FOLD_TIMING = { duration: 460, easing: Easing.bezier(0.22, 1, 0.36, 1) };

export function ActionPill({
  items,
  containerStyle,
  variant = "solid",
  liquid: wantsLiquid = false,
  collapsed = false,
  onExpand,
}: ActionPillProps) {
  const glass = variant === "glass";
  const liquid = wantsLiquid && LIQUID_AVAILABLE;

  if (onExpand) {
    return (
      <FoldingPill
        items={items}
        glass={glass}
        liquid={liquid}
        collapsed={collapsed}
        onExpand={onExpand}
        containerStyle={containerStyle}
      />
    );
  }

  return (
    <View
      className={cn(
        "flex-row items-center rounded-full",
        liquid
          ? undefined
          : glass
            ? "overflow-hidden border border-white/[0.18]"
            : "overflow-hidden border border-black/5 bg-white"
      )}
      // PLATFORM-SHADOW
      style={[
        liquid
          ? glass
            ? undefined
            : LIQUID_SHADOW
          : glass
            ? undefined
            : SOLID_SHADOW,
        containerStyle,
      ]}
    >
      {liquid ? (
        <GlassView
          glassEffectStyle="regular"
          colorScheme={glass ? "dark" : "light"}
          isInteractive
          style={[StyleSheet.absoluteFill, { borderRadius: 999 }]}
        />
      ) : (
        glass && (
          <>
            <BlurView
              intensity={40}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
            <View className="absolute inset-0 bg-white/10" />
          </>
        )
      )}
      {items.map((item, index) => {
        const Icon = item.icon;
        const isFirst = index === 0;
        const isLast = index === items.length - 1;
        return (
          <HapticPressable
            key={index}
            accessibilityRole="button"
            accessibilityState={item.isActive ? { selected: true } : {}}
            accessibilityLabel={item.accessibilityLabel}
            testID={item.testID}
            onPress={item.onPress}
            onLongPress={item.onLongPress}
            // The former container padding + gap live inside each item, so every
            // pressable fills its slice of the pill (padding and half the gap
            // included) and a tap near the icon — not just on it — registers.
            className={cn(
              "items-center justify-center py-3",
              isFirst && isLast
                ? "px-5"
                : isFirst
                  ? "pl-5 pr-3.5"
                  : isLast
                    ? "pl-3.5 pr-5"
                    : "px-3.5"
            )}
          >
            <Icon
              isActive={item.isActive}
              size={24}
              tone={glass ? "light" : "dark"}
            />
          </HapticPressable>
        );
      })}
    </View>
  );
}

/**
 * The floating tab bar's pill, which folds to a circle holding the current tab.
 * One value drives the whole fold: the width closes in, the row slides so the
 * current tab ends up centred, and the others fade on the way, so the glass
 * moves as one piece instead of swapping contents.
 */
function FoldingPill({
  items,
  glass,
  liquid,
  collapsed,
  onExpand,
  containerStyle,
}: {
  items: ActionPillItem[];
  glass: boolean;
  liquid: boolean;
  collapsed: boolean;
  onExpand: () => void;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(collapsed ? 1 : 0);
  const active = Math.max(
    0,
    items.findIndex((item) => item.isActive)
  );
  const openWidth = SLOT * items.length;
  // Where the row sits once folded: the current tab centred in the circle.
  const foldedShift = active * SLOT + (SLOT - FOLDED) / 2;

  React.useEffect(() => {
    progress.value = reduceMotion
      ? collapsed
        ? 1
        : 0
      : withTiming(collapsed ? 1 : 0, FOLD_TIMING);
  }, [collapsed, reduceMotion, progress]);

  const shell = useAnimatedStyle(() => ({
    width: interpolate(progress.value, [0, 1], [openWidth, FOLDED]),
  }));
  const row = useAnimatedStyle(() => ({
    transform: [{ translateX: -foldedShift * progress.value }],
  }));

  return (
    <Animated.View
      className={cn(
        "rounded-full",
        !liquid &&
          (glass
            ? "border border-white/[0.18]"
            : "border border-black/5 bg-white")
      )}
      // PLATFORM-SHADOW
      style={[
        { height: FOLDED },
        glass ? undefined : liquid ? LIQUID_SHADOW : SOLID_SHADOW,
        shell,
        containerStyle,
      ]}
    >
      {liquid ? (
        <GlassView
          glassEffectStyle="regular"
          colorScheme={glass ? "dark" : "light"}
          isInteractive
          style={[StyleSheet.absoluteFill, { borderRadius: FOLDED / 2 }]}
        />
      ) : (
        glass && (
          <View className="absolute inset-0 overflow-hidden rounded-full">
            <BlurView
              intensity={40}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
            <View className="absolute inset-0 bg-white/10" />
          </View>
        )
      )}
      <View
        className="absolute inset-0 overflow-hidden"
        style={{ borderRadius: FOLDED / 2 }}
        pointerEvents={collapsed ? "none" : "auto"}
        accessibilityElementsHidden={collapsed}
        importantForAccessibility={collapsed ? "no-hide-descendants" : "auto"}
      >
        <Animated.View
          className="flex-row"
          style={[{ width: openWidth, height: FOLDED }, row]}
        >
          {items.map((item, index) => (
            <FoldingItem
              key={item.testID ?? index}
              item={item}
              glass={glass}
              progress={progress}
            />
          ))}
        </Animated.View>
      </View>
      {collapsed && (
        <HapticPressable
          accessibilityRole="button"
          accessibilityLabel="Show tabs"
          onPress={onExpand}
          className="absolute inset-0"
        />
      )}
    </Animated.View>
  );
}

function FoldingItem({
  item,
  glass,
  progress,
}: {
  item: ActionPillItem;
  glass: boolean;
  progress: SharedValue<number>;
}) {
  const Icon = item.icon;
  const fade = useAnimatedStyle(() => ({
    // The other tabs are gone well before the circle closes, so nothing is
    // ever seen clipped by its edge.
    opacity: item.isActive
      ? 1
      : interpolate(progress.value, [0, 0.55], [1, 0], "clamp"),
  }));
  return (
    <Animated.View style={[{ width: SLOT, height: FOLDED }, fade]}>
      <HapticPressable
        accessibilityRole="button"
        accessibilityState={item.isActive ? { selected: true } : {}}
        accessibilityLabel={item.accessibilityLabel}
        testID={item.testID}
        onPress={item.onPress}
        onLongPress={item.onLongPress}
        className="flex-1 items-center justify-center"
      >
        <Icon
          isActive={item.isActive}
          size={24}
          tone={glass ? "light" : "dark"}
        />
      </HapticPressable>
    </Animated.View>
  );
}
