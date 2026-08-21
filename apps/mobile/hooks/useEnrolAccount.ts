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
 * Neither the public key nor the recovery signer is sent. The backend reads the
 * key out of the attestation it verified and mints the recovery signer itself,
 * so a caller cannot attest with real hardware and enrol a software key, nor
 * nominate a recovery address it already controls. Either would hand one party
 * two of the three signers.
 */
export function useEnrolAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      // A key already on the device belongs to an attempt that got as far as
      // attesting. Attesting again would mint a new one, and `enrol` replaces
      // what is there — stranding the sub-organization the backend built around
      // the old key, on every transient failure, forever. The backend only
      // honours a key it already holds an approval signer for, so an unknown
      // one falls through to a fresh attestation below.
      const existing = await hardwareKey.getPublicKey();
      if (existing) {
        try {
          return await apiClient.enrolAccount({ hardwarePublicKey: existing });
        } catch (err) {
          if (__DEV__) {
            console.warn("[enrol] could not resume with the existing key", err);
          }
        }
      }

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
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY });
    },
  });
}
