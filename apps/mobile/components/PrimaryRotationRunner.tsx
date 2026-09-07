import { useFinishPrimaryRotation } from "@/hooks/useReplacePasskey";

/**
 * Lands a passkey replacement once its security delay has run out.
 *
 * The execute step is signed by the Device Key, which lives on this phone, so
 * it can only happen the next time Xend is opened. Headless and silent: the
 * Consumer asked for this a day ago, and landing it is bookkeeping.
 */
export function PrimaryRotationRunner() {
  useFinishPrimaryRotation();
  return null;
}
