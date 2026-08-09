import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ACCOUNT_QUERY_KEY } from "@/hooks/useAccount";
import { devicePlatform, hardwareKey } from "@/modules/hardware-key/src";
import { apiClient } from "@/utils/apiClient";

/**
 * Creates the Consumer's Account: hardware key, attestation, then enrolment.
 *
 * The nonce is fetched immediately before the key is generated. It is single
 * use and short-lived on the server, so fetching it earlier (at screen mount,
 * say) risks it expiring behind a biometric prompt and failing an enrolment
 * that was otherwise fine.
 *
 * The public key is never sent. The backend reads it out of the attestation it
 * verified, so a device cannot attest with real hardware and enrol a key it
 * generated in software.
 */
export function useEnrolAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ recoverySigner }: { recoverySigner: string }) => {
      const { nonce } = await apiClient.requestEnrolmentNonce();

      let attestation: string;
      try {
        ({ attestation } = await hardwareKey.enrol(nonce));
      } catch (err) {
        // The native side already discards a key whose attestation failed;
        // this covers the case where it could not.
        await hardwareKey.reset().catch(() => {});
        throw err;
      }

      return apiClient.enrolAccount({
        platform: devicePlatform(),
        attestation,
        nonce,
        recoverySigner,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY });
    },
  });
}
