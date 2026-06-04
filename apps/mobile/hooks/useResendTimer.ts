import { useState, useEffect, useCallback } from "react";
import * as Sentry from "@sentry/react-native";

interface UseResendTimerProps {
  initialSeconds?: number;
  onResend: () => Promise<void>;
}

export function useResendTimer({
  initialSeconds = 30,
  onResend,
}: UseResendTimerProps) {
  const [countdown, setCountdown] = useState(0);
  const [isDisabled, setIsDisabled] = useState(false);

  useEffect(() => {
    if (countdown <= 0) {
      return;
    }
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setIsDisabled(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [countdown]);

  const handleResend = useCallback(async () => {
    try {
      setIsDisabled(true);
      await onResend();
      setCountdown(initialSeconds);
    } catch (error) {
      Sentry.captureException(
        new Error(
          `Failed to resend code: ${error}. (hooks)/useResendTimer.ts (handleResend)`
        )
      );
      setIsDisabled(false);
      console.error("Failed to resend code:", error);
    }
  }, [initialSeconds, onResend]);

  return {
    countdown: countdown > 0 ? countdown : undefined,
    isDisabled,
    handleResend,
  };
}
