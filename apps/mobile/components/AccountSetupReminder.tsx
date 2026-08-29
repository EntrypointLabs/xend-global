import { useEffect, useState } from "react";
import { router, usePathname } from "expo-router";

import { AccountSetupModal } from "@/components/ui/organisms/modals/AccountSetupModal";
import { useAccountSetup } from "@/hooks/useAccountSetup";
import { useAccountSetupStatus } from "@/hooks/useAccountSetupStatus";
import { useAuth } from "@/contexts/AuthContext";

/** Where the reminder belongs: the screen a Consumer lands on and returns to. */
const HOME = "/";

/**
 * Finishes an Account the Consumer left half-built.
 *
 * Dismissable, but it comes back. Until setup runs there is no Account at all:
 * no vault, no three signers, and no recovery signer, which is the 0 of 3
 * state the design exists to prevent. So a session in that state is unfinished
 * sign-up rather than a usable wallet, and the shell keeps returning them to
 * it rather than letting them browse a dashboard with nothing behind it.
 *
 * It stays dismissable on purpose. Setup writes to the chain and can fail for
 * reasons the Consumer cannot fix, and locking somebody out of the app over an
 * RPC hiccup is worse than the state it prevents.
 *
 * Returning on every return to Home, rather than on every screen: a prompt
 * that follows you around is one people learn to dismiss without reading,
 * which is the same outcome by a worse route.
 */
export function AccountSetupReminder() {
  const { data: status } = useAccountSetupStatus();
  const { email } = useAuth();
  const { stage, error, run, clearError } = useAccountSetup();
  const [dismissed, setDismissed] = useState(false);
  const pathname = usePathname();

  const atHome = pathname === HOME;
  const unfinished = status?.finished === false;

  // Leaving Home clears the dismissal, so coming back asks again.
  useEffect(() => {
    if (!atHome) setDismissed(false);
  }, [atHome]);

  const finish = async () => {
    // The Account's recovery signer is anchored on the Consumer's address, so
    // with none on file there is nothing setup can do but fail. Ask for the
    // address instead; that screen builds the Account once it has one.
    if (!email) {
      router.push("/add-email");
      return;
    }
    await run();
  };

  if (!atHome || !unfinished || dismissed) return null;

  return (
    <AccountSetupModal
      visible
      stage={stage}
      error={error}
      onStart={finish}
      onRetry={finish}
      onSkip={() => {
        clearError();
        setDismissed(true);
      }}
    />
  );
}
