import { useState } from "react";

import { PendingChangeModal } from "@/components/ui/organisms/modals/PendingChangeModal";
import {
  usePendingAccountChange,
  useRejectAccountChange,
} from "@/hooks/usePendingAccountChange";

/**
 * Surfaces a staged settings change wherever the Consumer is in the app.
 *
 * Mounted in the signed-in shell rather than on a screen, because there is no
 * screen they are guaranteed to visit and the window to reject is finite. The
 * push notification reaches them when the app is closed; this is what reaches
 * them when it is open.
 *
 * A dismissal lasts for this launch only. The change outlives it, so agreeing
 * that it was them should not silence the notice for the next 24 hours if they
 * later realise it was not.
 */
export function PendingChangeNotice() {
  const { data: change } = usePendingAccountChange();
  const reject = useRejectAccountChange();
  const [dismissed, setDismissed] = useState(false);

  if (!change || dismissed) return null;

  return (
    <PendingChangeModal
      visible
      executableAt={change.executableAt}
      rejecting={reject.isPending}
      error={
        reject.isError
          ? "We could not reject that change. Check your connection and try again."
          : null
      }
      onReject={() => reject.mutate()}
      onDismiss={() => setDismissed(true)}
    />
  );
}
