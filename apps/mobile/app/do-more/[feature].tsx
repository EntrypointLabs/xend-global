import React from "react";
import { Redirect, useLocalSearchParams } from "expo-router";

import { FeatureIntro } from "@/components/ui/feature/FeatureIntro";
import { doMoreFeatureSlug, doMoreItem } from "@/utils/doMore";

/** A Do more feature's own page, from its entry in the list. */
export default function DoMoreFeatureScreen() {
  const { feature } = useLocalSearchParams<{ feature: string }>();
  const item = feature ? doMoreItem(feature) : undefined;
  if (!item?.intro) return <Redirect href="/do-more" />;
  return <FeatureIntro {...item.intro} feature={doMoreFeatureSlug(item)} />;
}
