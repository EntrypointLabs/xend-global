import { PendingChangeModal } from "@/components/ui/organisms/modals/PendingChangeModal";
import {
  usePendingAccountChanges,
  useRejectAccountChange,
} from "@/hooks/usePendingAccountChange";
import { useInitiatedChanges } from "@/hooks/useInitiatedChange";
import { usePendingChangeAcknowledgement } from "@/hooks/usePendingChangeAcknowledgement";

/**
 * Interrupts the Consumer when their Account is being changed by someone else.
 *
 * Only by someone else, and "someone else" is decided by this device rather
 * than by the server. A change this phone started announces itself on the home
 * screen instead: raising the alarm over an action they just took teaches them
 * that the alarm means nothing, which is the one thing it cannot afford to mean
 * on the day it is real.
 *
 * The server cannot make that call. It sees one Account with one staged change,
 * so a flag it sets would silence every device, including the phone somebody is
 * trying to take the Account away from, which is the one that has to ring.
 *
 * Acknowledging is remembered across launches and keyed to that specific
 * change, so answering it once settles it. A different change later still
 * interrupts.
 *
 * Several changes can wait at once. They are shown one at a time, somebody
 * else's before the Consumer's own, so each gets its own answer.
 */
export function PendingChangeNotice() {
  const { data: changes } = usePendingAccountChanges();
  const reject = useRejectAccountChange();
  const {
    isAcknowledged,
    isPending,
    acknowledge,
    reviewRequested,
    clearReview,
  } = usePendingChangeAcknowledgement();
  const { startedHere, isPending: readingInitiated } = useInitiatedChanges();

  // Nothing is shown until the stored answer is known: flashing the alarm at
  // someone who already answered it is the failure this exists to avoid.
  if (isPending || readingInitiated || !changes) return null;

  const unanswered = changes.filter(
    (candidate) => !isAcknowledged(candidate.transactionIndex)
  );
  // Started on this phone, so the home screen carries it rather than a modal,
  // unless they tapped through from that banner and asked to see it.
  const change =
    unanswered.find((candidate) => !startedHere(candidate.transactionIndex)) ??
    (reviewRequested ? unanswered[0] : undefined);
  if (!change) return null;

  return (
    <PendingChangeModal
      visible
      startedHere={startedHere(change.transactionIndex)}
      executableAt={change.executableAt}
      rejecting={reject.isPending}
      error={
        reject.isError
          ? "We could not reject that change. Check your connection and try again."
          : null
      }
      onReject={() => reject.mutate(change.transactionIndex)}
      onDismiss={() => {
        clearReview();
        acknowledge(
          change.transactionIndex,
          changes.map((waiting) => waiting.transactionIndex)
        );
      }}
    />
  );
}
