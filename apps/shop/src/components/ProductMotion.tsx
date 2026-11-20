"use client";

import { usePathname, useRouter } from "next/navigation";
import { addTransitionType, startTransition, useLayoutEffect } from "react";

const OPENED_KEY = "prydd-shop-opened";
const RETURN_KEY = "prydd-shop-return";
const FLY_AWAY_MS = 180;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function remember(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Storage blocked: the page still navigates, it just won't restore its place.
  }
}

/** Items above the anchor leave upward, items below downward; same-row items split by side. */
function flyDirection(item: DOMRect, anchor: DOMRect): 1 | -1 {
  if (Math.abs(item.top - anchor.top) > 4)
    return item.top < anchor.top ? -1 : 1;
  return item.left < anchor.left ? -1 : 1;
}

function others(anchor: Element) {
  return [...document.querySelectorAll<HTMLElement>("[data-product]")].filter(
    (el) => el !== anchor,
  );
}

export function ProductGridMotion({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useLayoutEffect(() => {
    let saved: { slug: string; scrollY: number } | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(RETURN_KEY) ?? "null");
      sessionStorage.removeItem(RETURN_KEY);
    } catch {
      return;
    }
    if (!saved) return;
    window.scrollTo(0, saved.scrollY);
    const anchor = document.querySelector(
      `[data-product="${CSS.escape(saved.slug)}"]`,
    );
    if (!anchor || reducedMotion()) return;
    const at = anchor.getBoundingClientRect();
    for (const el of others(anchor)) {
      el.style.setProperty(
        "--fly",
        String(flyDirection(el.getBoundingClientRect(), at)),
      );
      el.classList.add("fly-in");
      el.addEventListener("animationend", () => el.classList.remove("fly-in"), {
        once: true,
      });
    }
    document.querySelectorAll<HTMLElement>("[data-fly-fade]").forEach((el) => {
      el.classList.add("fly-fade-in");
      el.addEventListener(
        "animationend",
        () => el.classList.remove("fly-fade-in"),
        { once: true },
      );
    });
  }, []);

  const onClickCapture = (e: React.MouseEvent) => {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    )
      return;
    const anchor = (e.target as Element).closest<HTMLAnchorElement>(
      "a[data-product]",
    );
    if (!anchor) return;
    e.preventDefault();
    const slug = anchor.dataset.product!;
    remember(OPENED_KEY, JSON.stringify({ slug, scrollY: window.scrollY }));

    const go = () =>
      startTransition(() => {
        addTransitionType("product-open");
        router.push(anchor.pathname);
      });
    if (reducedMotion()) return go();

    const at = anchor.getBoundingClientRect();
    for (const el of others(anchor)) {
      el.style.setProperty(
        "--fly",
        String(flyDirection(el.getBoundingClientRect(), at)),
      );
      el.classList.add("fly-away");
    }
    document
      .querySelectorAll<HTMLElement>("[data-fly-fade]")
      .forEach((el) => el.classList.add("fly-fade-out"));
    window.setTimeout(go, FLY_AWAY_MS);
  };

  return <div onClickCapture={onClickCapture}>{children}</div>;
}

/** The way back from a product page: morphs the image home and lands on the spot it left. */
export function useCloseProduct() {
  const router = useRouter();
  const pathname = usePathname();
  const onProduct = pathname.startsWith("/products/");
  return {
    onProduct,
    close: (e: React.MouseEvent) => {
      if (!onProduct || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      e.preventDefault();
      const slug = pathname.split("/")[2];
      let scrollY = 0;
      try {
        const opened = JSON.parse(sessionStorage.getItem(OPENED_KEY) ?? "null");
        if (opened?.slug === slug) scrollY = opened.scrollY;
      } catch {
        // Fall back to the top of the grid.
      }
      remember(RETURN_KEY, JSON.stringify({ slug, scrollY }));
      startTransition(() => {
        addTransitionType("product-close");
        router.push("/", { scroll: false });
      });
    },
  };
}
