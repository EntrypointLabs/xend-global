import React, {
  createContext,
  useContext,
  useCallback,
  useRef,
  useState,
} from "react";
import { Animated, View } from "react-native";
import { BlurView } from "expo-blur";
import { Typography } from "@/components/ui/atoms/Typography";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface ToastOptions {
  label: string;
  icon?: React.ReactNode;
  duration?: number;
}

interface ToastContextType {
  showToast: (label: string, icon?: React.ReactNode) => void;
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
  const [toast, setToast] = useState<ToastOptions | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const showToast = useCallback(
    (label: string, icon?: React.ReactNode) => {
      // Clear any existing hide timer
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }

      // Reset animation values for new toast
      translateY.setValue(-100);
      opacity.setValue(0);

      setToast({ label, icon });

      // Slide in from the top
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

      // Auto-hide after duration
      hideTimer.current = setTimeout(() => {
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
        ]).start(() => setToast(null));
      }, 3000);
    },
    [translateY, opacity]
  );

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
          <BlurView
            intensity={40}
            tint="dark"
            className="overflow-hidden rounded-full border"
            style={{ borderColor: "rgba(255, 255, 255, 0.50)" }}
          >
            <View
              className="flex-row items-center px-4 py-2.5"
              style={{ backgroundColor: "rgba(255, 255, 255, 0.80)" }}
            >
              {toast.icon && <View className="mr-2">{toast.icon}</View>}
              <Typography weight="600" className="text-sm text-black">
                {toast.label}
              </Typography>
            </View>
          </BlurView>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}
