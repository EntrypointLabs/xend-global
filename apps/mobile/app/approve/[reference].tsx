import { useEffect } from "react";
import { Redirect, useLocalSearchParams } from "expo-router";

import { requestApproval } from "@/utils/approvalRequests";
import { SEED_DEMO } from "@/utils/devSeed";
import { demoApproval } from "@/utils/devSeedApproval";

/**
 * `xend://approve/<reference>`, carried on the approval notice. The takeover
 * lives above every screen, so this only names the Payment and steps aside.
 */
export default function ApproveDeepLink() {
  const { reference } = useLocalSearchParams<{ reference: string }>();
  useEffect(() => {
    if (!reference) return;
    if (SEED_DEMO) demoApproval.request(reference);
    requestApproval(reference);
  }, [reference]);
  return <Redirect href="/(tabs)" />;
}
