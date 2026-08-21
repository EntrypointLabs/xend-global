import { useEffect, useState } from "react";

import { AccountSetupModal } from "@/components/ui/organisms/modals/AccountSetupModal";
import { useAccountSetup } from "@/hooks/useAccountSetup";
import { useAccountSetupStatus } from "@/hooks/useAccountSetupStatus";

/**
 * Offers to finish an Account the Consumer left half-built.
 *
 * "Not now" during sign-up used to be permanent: it cleared the only gate that
 * kept them in the flow, and nothing ever asked again, so they stayed on the
 * weaker Privy wallet or held a vault that could not spend. Asking from the
 * signed-in shell instead means the offer comes back on the next launch.
 *
 * Once per launch, though. A prompt that returns on every screen is one people
 * learn to dismiss without reading, which is the same outcome by a worse route.
 */
export function AccountSetupReminder() {
  const { data: status } = useAccountSetupStatus();
  const { stage, error, run, clearError } = useAccountSetup();
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);

  const unfinished = status?.finished === false;
  useEffect(() => {
    if (unfinished && !dismissed) setVisible(true);
  }, [unfinished, dismissed]);

  const finish = async () => {
    if (await run()) setVisible(false);
  };

  const skip = () => {
    clearError();
    setDismissed(true);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <AccountSetupModal
      visible
      stage={stage}
      error={error}
      onStart={finish}
      onRetry={finish}
      onSkip={skip}
    />
  );
}
