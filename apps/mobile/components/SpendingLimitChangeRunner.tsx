import { useFinishSpendingLimitChange } from "@/hooks/useSpendingLimitChange";

/**
 * Finishes a Spending Limit change once its security delay has run out.
 *
 * The same bookkeeping the recovery key runner does, and for the same reason:
 * the execute step is signed by the key on this phone, so nothing on the
 * server can land it. Without this a new limit sits approved and waiting on
 * nobody.
 */
export function SpendingLimitChangeRunner() {
  useFinishSpendingLimitChange();
  return null;
}
