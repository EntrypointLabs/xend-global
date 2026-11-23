/**
 * Tracks system prompts the app raised itself: Face ID, a passkey sheet, a
 * permission alert, the paste confirmation.
 *
 * iOS reports the app as inactive while one of these is up, exactly as it does
 * when the Consumer opens the app switcher. The privacy cover reads this to
 * tell the two apart, so a prompt appears over the screen the Consumer was on
 * instead of over a covered one.
 */
let open = 0;
let settledAt = 0;

// iOS can report inactive a beat after the call that raised the prompt has
// already returned, for example when the Consumer answers quickly.
const SETTLE_MS = 600;

export async function withSystemPrompt<T>(raise: () => Promise<T>): Promise<T> {
  open += 1;
  try {
    return await raise();
  } finally {
    open -= 1;
    settledAt = Date.now();
  }
}

export function isSystemPromptOpen(): boolean {
  return open > 0 || Date.now() - settledAt < SETTLE_MS;
}
