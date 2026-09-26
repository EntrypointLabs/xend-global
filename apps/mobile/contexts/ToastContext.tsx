import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Animated, View } from "react-native";
import { Typography } from "@/components/ui/atoms/Typography";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cn } from "@/utils/cn";
import {
  setToastHandler,
  type ToastOptions,
  type ToastTone,
} from "@/utils/toast";

const DEFAULT_DURATION_MS = 3000;

const TONE_SURFACE: Record<ToastTone, string> = {
  default: "border-black/5",
  success: "border-success/20 bg-success/10",
  failed: "border-destructive/20 bg-destructive/10",
};

const TONE_TEXT: Record<ToastTone, string> = {
  default: "text-black",
  success: "text-success",
  failed: "text-destructive",
};

interface ToastState {
  label: string;
  icon?: React.ReactNode;
  tone: ToastTone;
  id?: string;
}

interface ToastContextType {
  showToast: (
    label: string,
    icon?: React.ReactNode,
    options?: ToastOptions
  ) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-100)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const [toast, setToast] = useState<ToastState | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(null);
  const visibleId = useRef<string | null>(null);

  const showToast = useCallback(
    (label: string, icon?: React.ReactNode, options?: ToastOptions) => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }

      const id = options?.id;
      const replacesVisible = id !== undefined && visibleId.current === id;
      visibleId.current = id ?? null;
      setToast({ label, icon, tone: options?.tone ?? "default", id });

      if (!replacesVisible) {
        translateY.setValue(-100);
        opacity.setValue(0);
        Animated.parallel([
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            damping: 20,
            stiffness: 300,
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start();
      }

      hideTimer.current = setTimeout(() => {
        visibleId.current = null;
        // A toast shown mid-exit stops this animation, and clearing then
        // would blank the toast that interrupted it.
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: -100,
            duration: 250,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 250,
            useNativeDriver: true,
          }),
        ]).start(({ finished }) => {
          if (finished) setToast(null);
        });
      }, options?.durationMs ?? DEFAULT_DURATION_MS);
    },
    [translateY, opacity]
  );

  useEffect(() => {
    setToastHandler(showToast);
    return () => setToastHandler(null);
  }, [showToast]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <Animated.View
          pointerEvents="none"
          className="absolute left-0 right-0 items-center"
          style={[
            {
              top: insets.top + 8,
              transform: [{ translateY }],
              opacity,
              zIndex: 9999,
            },
          ]}
        >
          <View
            className="mx-4 rounded-full bg-white"
            // PLATFORM-SHADOW: lifts the pill off same-colored content so it
            // stays visible on both iOS and Android (no reliable blur on Android).
            style={{
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.12,
              shadowRadius: 12,
              elevation: 6,
            }}
          >
            {/* The tint sits on a white base because a translucent pill would
                show whatever it floats over. */}
            <View
              className={cn(
                "flex-row items-center rounded-full border px-4 py-2.5",
                TONE_SURFACE[toast.tone]
              )}
            >
              {toast.icon && <View className="mr-2">{toast.icon}</View>}
              <Typography
                weight="600"
                className={cn("shrink text-sm", TONE_TEXT[toast.tone])}
              >
                {toast.label}
              </Typography>
            </View>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}
