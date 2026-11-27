import React from "react";

import { FeatureIntro } from "@/components/ui/feature/FeatureIntro";

/** Split a bill, from the country card. Not built yet, so it explains itself. */
export default function SplitBillScreen() {
  return (
    <FeatureIntro
      illustration="split"
      feature="split_bill"
      headline="Split any bill"
      benefits={[
        {
          icon: "receipt-outline",
          title: "Pick what to split",
          body: "Choose a payment you made, or enter an amount yourself.",
        },
        {
          icon: "people-outline",
          title: "Ask friends for their share",
          body: "Split it evenly or set each person's part.",
        },
        {
          icon: "checkmark-done-outline",
          title: "See who has paid",
          body: "Each share lands in your account as it comes in.",
        },
      ]}
    />
  );
}
