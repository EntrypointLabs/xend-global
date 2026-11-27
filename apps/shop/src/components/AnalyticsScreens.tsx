"use client";

import { useParams, usePathname } from "next/navigation";
import { useEffect } from "react";
import { analytics, routeToScreenName } from "@/lib/analytics";

export function AnalyticsScreens() {
  const pathname = usePathname();
  const params = useParams();
  const screen = routeToScreenName(pathname, params ?? {});
  useEffect(() => {
    analytics.screen(screen);
  }, [screen]);
  return null;
}
