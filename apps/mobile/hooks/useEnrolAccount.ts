import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Sentry from "@sentry/react-native";

import { ACCOUNT_QUERY_KEY } from "@/hooks/useAccount";
import { devicePlatform, hardwareKey } from "@/modules/hardware-key/src";
import { apiClient, apiErrorCode, apiErrorStatus } from "@/utils/apiClient";

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
      // honours a key it already holds an approval signer for, and says so
      // with a typed refusal: that one falls through to a fresh attestation
      // below. Anything else (network, a server fault) is a failed attempt to
      // retry, not a reason to mint a second key.
      const existing = await hardwareKey.getPublicKey();
      if (existing) {
        try {
          return await apiClient.enrolAccount({ hardwarePublicKey: existing });
        } catch (err) {
          const unattested =
            apiErrorStatus(err) === 409 &&
            apiErrorCode(err) === "DEVICE_NOT_ATTESTED";
          if (!unattested) throw err;
          if (__DEV__) {
            console.warn("[enrol] key on this phone is not attested here", err);
          }
        }
      }

      const { nonce } = await apiClient.requestEnrolmentNonce();

      let attestation: string;
      let publicKey: string;
      try {
        ({ attestation, publicKey } = await hardwareKey.enrol(nonce));
      } catch (err) {
        // The native side already discards a key whose attestation failed;
        // this covers the case where it could not.
        await hardwareKey.reset().catch((resetError) => {
          Sentry.captureException(resetError, {
            tags: { hardwareKey: "reset-after-failed-attestation" },
          });
        });
        throw err;
      }

      // iOS attests over the nonce and this key together, because App Attest
      // cannot attest the Secure Enclave key that will stamp Turnkey. Android's
      // attestation carries its own key and ignores this.
      return apiClient.enrolAccount({
        platform: devicePlatform(),
        attestation,
        nonce,
        hardwarePublicKey: publicKey,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY });
    },
  });
}
