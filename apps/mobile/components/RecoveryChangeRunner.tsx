import { useFinishRecoveryChange } from "@/hooks/useRecoveryChange";

/**
 * Finishes a recovery key change once its security delay has run out.
 *
 * The change is proposed and approved in one sitting, then waits a day. Nothing
 * on the server can finish it: the execute step is signed by S1, which lives on
 * this device, so it can only happen the next time the Consumer opens Xend.
 * Without this the key sits at "waiting to become active" indefinitely, having
 * been approved by both keys and blocked on nobody.
 *
 * Headless and silent by design. The Consumer agreed to this change a day ago;
 * landing it is bookkeeping rather than a decision, and S1 signs without a
 * prompt.
 */
export function RecoveryChangeRunner() {
  useFinishRecoveryChange();
  return null;
}
