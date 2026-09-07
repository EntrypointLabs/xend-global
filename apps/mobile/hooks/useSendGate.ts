import { useCallback } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { ENTRY_SESSION_SEND_MESSAGE } from "@/utils/errors";
import { showToast } from "@/utils/toast";

/**
 * Opens Send only from a session that can sign a Spend.
 *
 * An entry session is what an email code opens: it can look and start a
 * recovery, and the server refuses anything that moves money. Saying so here
 * spares the Consumer a flow that ends in a refusal several taps later.
 */
export function useSendGate() {
  const { sessionTier } = useAuth();

  return useCallback(
    (open: () => void) => {
      if (sessionTier === "entry") {
        showToast(ENTRY_SESSION_SEND_MESSAGE);
        return;
      }
      open();
    },
    [sessionTier]
  );
}
