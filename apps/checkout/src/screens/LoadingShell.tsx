/**
 * The first paint the popup opens to, rendered synchronously with no Privy
 * import. Also the handshake wait state: when the popup was opened without an
 * intent param, this stays up until the SDK navigation arrives with the intent.
 */
export function LoadingShell() {
  return (
    <div className="bg-brand-black flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-5">
        <span className="text-brand-ink text-3xl font-medium tracking-tight">
          Xend
        </span>
        <span className="bg-brand-line h-1 w-24 overflow-hidden rounded-full">
          <span className="bg-brand-muted block h-full w-1/2 animate-pulse rounded-full" />
        </span>
      </div>
    </div>
  );
}
