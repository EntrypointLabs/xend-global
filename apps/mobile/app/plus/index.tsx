import React from "react";

import { FeaturePreviewScreen } from "@/components/ui/layout/FeaturePreviewScreen";
import { XEND_PLUS_BENEFITS } from "@/constants/FeaturePreviews";

export default function XendPlusScreen() {
  return (
    <FeaturePreviewScreen
      mark="sparkles"
      title="Xend Plus"
      subtitle="A membership for people who use Xend every day."
      benefits={XEND_PLUS_BENEFITS}
    />
  );
}
