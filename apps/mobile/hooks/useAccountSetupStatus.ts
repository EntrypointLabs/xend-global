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
  const { user } = useAuth();

  return useQuery({
    queryKey: ACCOUNT_SETUP_STATUS_KEY,
    queryFn: async (): Promise<{ finished: boolean }> => {
      const account = await apiClient.getAccount();
      if (!account) return { finished: false };
      const step = await apiClient.nextProvisioningStep();
      return { finished: step.done };
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
