import { SYMBOL_PATH } from "./ProductArt";

export function Symbol({
  className,
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="20 18 160 166"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path d={SYMBOL_PATH} fill="currentColor" />
    </svg>
  );
}

export function Lockup({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <Symbol className="h-[18px] w-auto" />
      <span className="text-[15px] font-medium tracking-[0.22em]">PRYDD</span>
    </span>
  );
}
