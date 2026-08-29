import { useFinishDeviceRotation } from "@/hooks/useDeviceRotation";

/**
 * Lands a device rotation once its security delay has run out.
 *
 * Nothing on the server can finish it: the execute step is signed by the
 * passkey, which lives on this phone, so it can only happen the next time Xend
 * is opened. Without this the new Device Key would sit approved and waiting on
 * nobody.
 *
 * Headless and silent, like its recovery-key equivalent. The Consumer asked for
 * this a day ago; landing it is bookkeeping rather than a decision.
 */
export function DeviceRotationRunner() {
  useFinishDeviceRotation();
  return null;
}
