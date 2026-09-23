/** Exponential retry delay with +/-20% jitter, capped. Returns seconds. */
export function retryBackoff(
  attemptNo: number,
  baseSeconds: number,
  maxSeconds: number,
  random = Math.random,
): number {
  const capped = Math.min(
    baseSeconds * 2 ** Math.max(0, attemptNo - 1),
    maxSeconds,
  );
  const jitter = capped * (random() * 0.4 - 0.2);
  return Math.max(1, Math.round(capped + jitter));
}
