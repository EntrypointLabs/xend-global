import { useEffect } from "react";
import { Redirect } from "expo-router";

import { forgetDeferredApprovals } from "@/utils/approvalRequests";

/**
 * `https://prydd.co/approve`, linked from the checkout's "No notification?"
 * prompt. The checkout cannot name the Payment to the app, so this brings back
 * anything the Consumer set aside and lets the takeover show what is waiting.
 */
export default function ApproveAnyDeepLink() {
  useEffect(() => {
    forgetDeferredApprovals();
  }, []);
  return <Redirect href="/(tabs)" />;
}
