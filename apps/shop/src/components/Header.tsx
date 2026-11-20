"use client";

import Link from "next/link";
import { Lockup } from "./Logo";
import { useBag } from "./CartProvider";

export function Header() {
  const { count, ready } = useBag();
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between px-5 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-3"
          aria-label="Prydd Store home"
        >
          <Lockup />
          <span className="hidden border-l border-line pl-3 text-[13px] text-mute sm:inline">
            Store
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-[13px] font-medium">
          <Link
            href="/orders"
            className="rounded-full px-3.5 py-2 text-ink/70 transition-colors hover:bg-canvas-2 hover:text-ink"
          >
            Orders
          </Link>
          <Link
            href="/checkout"
            className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-canvas transition-transform active:scale-[0.97]"
          >
            Bag
            <span className="tnum min-w-[1ch] text-[12px] text-canvas/70">
              {ready ? count : ""}
            </span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
