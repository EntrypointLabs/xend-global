import React from "react";

import { FeaturePreviewScreen } from "@/components/ui/layout/FeaturePreviewScreen";
import { XEND_CARD_BENEFITS } from "@/constants/FeaturePreviews";

export default function XendCardScreen() {
  return (
    <FeaturePreviewScreen
      mark="card"
      title="Xend Card"
      subtitle="Spend your stablecoins the way you spend anything else."
      benefits={XEND_CARD_BENEFITS}
    />
  );
}
