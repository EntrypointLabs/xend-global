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
