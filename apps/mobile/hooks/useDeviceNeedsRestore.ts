import { useQuery } from "@tanstack/react-query";

import { useAccount } from "@/hooks/useAccount";
import { hardwareKey } from "@/modules/hardware-key/src";
import { SEED_DEMO } from "@/utils/devSeed";

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
      // A simulator holds no hardware key, so the seeded Account would always
      // read as locked out and the demo would open on the restore banner.
      if (SEED_DEMO) return { needsRestore: false };
      const key = await hardwareKey.getPublicKey();
      // Compared, not merely checked for absence. The native lookup falls back
      // to the pre-scoping alias when this account has no key of its own, so a
      // phone that once enrolled a different account hands back that account's
      // key: present, and useless here.
      const enrolled = account?.deviceKey ?? null;
      return {
        needsRestore: key === null || (enrolled !== null && key !== enrolled),
      };
    },
    // Only meaningful once there is an Account to be locked out of.
    enabled: !!account,
    staleTime: 5 * 60 * 1000,
  });
}
