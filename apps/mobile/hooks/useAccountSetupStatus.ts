import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { apiClient } from "@/utils/apiClient";

export const ACCOUNT_SETUP_STATUS_KEY = ["account", "setup-status"] as const;

/**
 * Whether the Consumer's Account is finished, asked of the chain.
 *
 * Both halves count. No Account at all leaves them on the Privy wallet; an
 * Account whose provisioning never completed has a vault that cannot spend.
 * Neither is visible from the account row, which is why this asks for the next
 * provisioning step rather than reading a stored flag: the answer is derived
 * from chain state, so it survives a reinstall and cannot go stale.
 */
export function useAccountSetupStatus() {
  const { user, sessionTier } = useAuth();

  return useQuery({
    // Keyed by Consumer: two accounts on one device must not read each other's
    // answer out of the cache.
    queryKey: [...ACCOUNT_SETUP_STATUS_KEY, user?.id ?? null],
    queryFn: async (): Promise<{ finished: boolean }> => {
      const account = await apiClient.getAccount();
      if (!account) return { finished: false };
      const step = await apiClient.nextProvisioningStep();
      return { finished: step.done };
    },
    // Finishing an Account needs the passkey, so an entry session is never
    // offered it: the step it would ask for is one the server refuses.
    enabled: !!user && sessionTier === "full",
    staleTime: 5 * 60 * 1000,
    // Asked again on every mount, and retried harder than the default. A
    // single failed read used to mean the offer to finish an Account never
    // appeared again for the rest of the session, which is the one case it
    // exists to catch: right after sign-up, when the token has just been
    // written and the first call can lose the race.
    refetchOnMount: "always",
    retry: 3,
  });
}
