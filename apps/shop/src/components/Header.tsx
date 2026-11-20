"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Symbol } from "./Logo";
import { useBag } from "./CartProvider";
import { useCloseProduct } from "./ProductMotion";

export function Header() {
  const { count, ready } = useBag();
  const home = usePathname() === "/";
  const { close } = useCloseProduct();
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-30 text-white mix-blend-difference">
      <div className="grid h-14 grid-cols-3 items-center px-4 sm:px-6">
        <div className="pointer-events-auto justify-self-start">
          {home ? (
            <span className="label">Issue 01</span>
          ) : (
            <Link
              href="/"
              onClick={close}
              className="label flex items-center gap-2 hover:opacity-60"
              aria-label="Back to the store"
            >
              <svg
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M10 3 5 8l5 5" />
              </svg>
              Store
            </Link>
          )}
        </div>
        <Link
          href="/"
          className="pointer-events-auto justify-self-center"
          aria-label="Prydd Store home"
        >
          <Symbol className="h-[18px] w-auto" />
        </Link>
        <nav className="pointer-events-auto flex items-center gap-5 justify-self-end">
          <Link href="/orders" className="label hover:opacity-60">
            Orders
          </Link>
          <Link
            href="/checkout"
            className="label flex items-center gap-2 hover:opacity-60"
            aria-label={`Bag, ${count} ${count === 1 ? "item" : "items"}`}
          >
            <svg
              viewBox="0 0 16 16"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
            >
              <path d="M3 5.5h10l-.7 8H3.7z" />
              <path d="M5.5 5.5V4a2.5 2.5 0 0 1 5 0v1.5" />
            </svg>
            <span className="tnum min-w-[1ch]">
              {ready && count > 0 ? count : ""}
            </span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
