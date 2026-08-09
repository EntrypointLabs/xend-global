/**
 * Whether a signing failure was the Consumer dismissing the prompt.
 *
 * A cancel is a decision, not a fault: it should return the screen to where it
 * was rather than surface an error.
 */
export function isUserCanceledSign(error: unknown): boolean {
  const message =
    (error instanceof Error ? error.message : String(error)) ?? "";
  const name = error instanceof Error ? error.name : "";
  return /cancel|denied|aborted|dismiss/i.test(`${name} ${message}`);
}
