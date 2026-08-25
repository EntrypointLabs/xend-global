import { useEffect, useState } from "react";

/**
 * "23h 41m" until the deadline, ticking, or null when there is no deadline yet.
 *
 * Minutes rather than seconds. A second-by-second countdown on a 24-hour window
 * is theatre, and it is the exact theatre a scam popup uses.
 */
export function useCountdown(deadline: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [deadline]);

  if (!deadline) return null;
  const msLeft = new Date(deadline).getTime() - now;
  if (!Number.isFinite(msLeft) || msLeft <= 0) return "Any moment now";

  const totalMinutes = Math.floor(msLeft / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
