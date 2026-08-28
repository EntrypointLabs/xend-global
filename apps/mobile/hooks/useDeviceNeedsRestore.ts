import { useQuery } from "@tanstack/react-query";

import { useAccount } from "@/hooks/useAccount";
import { hardwareKey } from "@/modules/hardware-key/src";

export const DEVICE_RESTORE_KEY = ["device", "needs-restore"] as const;

/**
 * Whether this phone can still sign as the Account's approval signer.
 *
 * An Account with no key on this device is the lost-phone case: the passkey
 * signed the Consumer in, so they can see everything, and nothing they try to
 * spend can reach two signatures. Worth saying out loud rather than letting
 * them discover it at a payment.
 *
 * The key lookup is scoped to the account by the wrapper, so a second Consumer
 * on the same phone reads their own answer rather than the other one's.
 */
export function useDeviceNeedsRestore() {
  const { data: account } = useAccount();

  return useQuery({
    queryKey: [...DEVICE_RESTORE_KEY, account?.address ?? null],
    queryFn: async () => {
      const key = await hardwareKey.getPublicKey();
      return { needsRestore: key === null };
    },
    // Only meaningful once there is an Account to be locked out of.
    enabled: !!account,
    staleTime: 5 * 60 * 1000,
  });
}
