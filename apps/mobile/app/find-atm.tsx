import React from "react";

import { FeatureIntro } from "@/components/ui/feature/FeatureIntro";

/** Find an ATM, from the country card. Not built yet, so it explains itself. */
export default function FindAtmScreen() {
  return (
    <FeatureIntro
      illustration="atm"
      feature="find_atm"
      headline="Cash, wherever you land"
      benefits={[
        {
          icon: "location-outline",
          title: "See ATMs near you",
          body: "A map of machines that take your Prydd card.",
        },
        {
          icon: "cash-outline",
          title: "Know the cost first",
          body: "See what a withdrawal costs before you take cash out.",
        },
        {
          icon: "globe-outline",
          title: "Works when you travel",
          body: "The same card, in any country you visit.",
        },
      ]}
    />
  );
}
