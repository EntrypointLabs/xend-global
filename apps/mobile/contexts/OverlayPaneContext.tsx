import { createContext, useContext, useMemo } from "react";
import { useRouter, type Href } from "expo-router";

interface OverlayPane {
  /** Slide this pane away, back to the overlay it came from. */
  back: () => void;
}

/**
 * Set around a screen that is being shown as a pane inside the Total Balance
 * overlay instead of as a route of its own. The same screen component serves
 * both, so it asks here how to leave and where its background comes from.
 */
export const OverlayPaneContext = createContext<OverlayPane | null>(null);

export function useInOverlayPane(): boolean {
  return useContext(OverlayPaneContext) !== null;
}

/**
 * Back and push for a screen that may be a pane. As a pane, Back slides it
 * away, and a push replaces the overlay: a page pushed on top of a modal is
 * presented as a sheet, which is not what a full page should be.
 */
export function usePaneNavigation() {
  const router = useRouter();
  const pane = useContext(OverlayPaneContext);
  return useMemo(
    () => ({
      back: pane ? pane.back : () => router.back(),
      push: (href: Href) => (pane ? router.replace(href) : router.push(href)),
    }),
    [pane, router]
  );
}
