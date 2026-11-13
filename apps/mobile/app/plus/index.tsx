import React from "react";

import { FeaturePreviewScreen } from "@/components/ui/layout/FeaturePreviewScreen";
import { PRYDD_PLUS_BENEFITS } from "@/constants/FeaturePreviews";

export default function PryddPlusScreen() {
  return (
    <FeaturePreviewScreen
      mark="sparkles"
      title="Prydd Plus"
      subtitle="A membership for people who use Prydd every day."
      benefits={PRYDD_PLUS_BENEFITS}
    />
  );
}
