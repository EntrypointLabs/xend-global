import { PendingChangeModal } from "@/components/ui/organisms/modals/PendingChangeModal";
import {
  usePendingAccountChange,
  useRejectAccountChange,
} from "@/hooks/usePendingAccountChange";
import { usePendingChangeAcknowledgement } from "@/hooks/usePendingChangeAcknowledgement";

/**
 * Interrupts the Consumer when their Account is being changed by someone else.
 *
 * Only by someone else. A change they started from this app announces itself on
 * the home screen instead: raising the alarm over an action they just took
 * teaches them that the alarm means nothing, which is the one thing it cannot
 * afford to mean on the day it is real.
 *
 * Acknowledging is remembered across launches and keyed to that specific
 * change, so answering it once settles it. A different change later still
 * interrupts.
 */
export function PendingChangeNotice() {
  const { data: change } = usePendingAccountChange();
  const reject = useRejectAccountChange();
  const { acknowledged, isPending, acknowledge } =
    usePendingChangeAcknowledgement();

  // Nothing is shown until the stored answer is known: flashing the alarm at
  // someone who already answered it is the failure this exists to avoid.
  if (isPending || !change) return null;
  // Their own doing, so the home screen carries it rather than a modal.
  if (change.selfInitiated) return null;
  if (acknowledged === change.transactionIndex) return null;

  return (
    <PendingChangeModal
      visible
      executableAt={change.executableAt}
      rejecting={reject.isPending}
      error={
        reject.isError
          ? "We could not reject that change. Check your connection and try again."
          : null
      }
      onReject={() => reject.mutate()}
      onDismiss={() => acknowledge(change.transactionIndex)}
    />
  );
}
