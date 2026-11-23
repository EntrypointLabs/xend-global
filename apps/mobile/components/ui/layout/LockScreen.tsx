import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { Typography } from "@/components/ui/atoms/Typography";
import HapticPressable from "@/components/ui/atoms/HapticPressable";
import LoadingScreen from "@/components/ui/layout/LoadingScreen";
import { useAppLock } from "@/contexts/AppLockContext";
import { usePalette } from "@/hooks/usePalette";

/**
 * Full-screen biometric gate. Prompts Face ID / fingerprint over a pitch-black
 * splash; if the prompt is cancelled it falls back to a "Locked" screen whose
 * Unlock button retries. Rendered by the auth layout while the app is locked.
 */
function LockScreen() {
  const { authenticate, isAuthenticating, promptReady } = useAppLock();
  const [showLocked, setShowLocked] = useState(false);
  const attempted = useRef(false);
  const palette = usePalette();

  const attempt = async () => {
    setShowLocked(false);
    const unlocked = await authenticate();
    if (!unlocked) setShowLocked(true);
  };

  useEffect(() => {
    if (promptReady && !attempted.current) {
      attempted.current = true;
      attempt();
    }
    // attempt is stable for a given mount; re-running on promptReady only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptReady]);

  if (isAuthenticating || !showLocked) {
    return <LoadingScreen />;
  }

  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      className="flex-1 bg-background px-6"
    >
      <StatusBar style="auto" />
      <View className="flex-1 items-center justify-center">
        <MaterialIcons
          name="lock"
          size={56}
          color={palette.dark ? palette.fg(0.3) : "#C4C4C4"}
        />
        <Typography
          weight="500"
          className="mt-3 text-lg text-[#9E9E9E] dark:text-foreground/40"
        >
          Locked
        </Typography>
      </View>
      <HapticPressable
        onPress={attempt}
        className="mb-2 items-center justify-center rounded-full bg-primary py-4"
      >
        <Typography weight="600" className="text-base text-primary-foreground">
          Unlock
        </Typography>
      </HapticPressable>
    </SafeAreaView>
  );
}

export default LockScreen;
