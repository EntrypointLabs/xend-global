import { useSyncExternalStore } from "react";

/**
 * Which waiting Payment the approval takeover should show, shared between the
 * things that can ask for it (a tapped notice, a deep link, the Finish payment
 * list) and the takeover itself, which lives above every screen.
 */
type State = {
  /** Asked for by name, so it wins over whatever else is waiting. */
  requested: string | null;
  /** Closed with "Later" in this visit to the app; not shown again until the next one. */
  deferred: ReadonlySet<string>;
};

let state: State = { requested: null, deferred: new Set() };
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

export function requestApproval(reference: string) {
  const deferred = new Set(state.deferred);
  deferred.delete(reference);
  set({ requested: reference, deferred });
}

export function deferApproval(reference: string) {
  const deferred = new Set(state.deferred);
  deferred.add(reference);
  set({
    requested: state.requested === reference ? null : state.requested,
    deferred,
  });
}

export function settleApproval(reference: string) {
  if (state.requested !== reference) return;
  set({ ...state, requested: null });
}

/** A new visit to the app: anything still waiting is worth asking about again. */
export function forgetDeferredApprovals() {
  if (state.deferred.size === 0) return;
  set({ ...state, deferred: new Set() });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useApprovalRequests(): State {
  return useSyncExternalStore(subscribe, () => state);
}
