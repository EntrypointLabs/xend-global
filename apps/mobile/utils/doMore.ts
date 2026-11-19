import type { Ionicons } from "@expo/vector-icons";

import type { FeatureIntroProps } from "@/components/ui/feature/FeatureIntro";

export type DoMoreSection = "Accounts" | "Grow" | "Automate";

export const DO_MORE_SECTIONS: DoMoreSection[] = [
  "Accounts",
  "Grow",
  "Automate",
];

export interface DoMoreItem {
  key: string;
  section: DoMoreSection;
  title: string;
  description: string;
  /** An Ionicons glyph, or "jar", which Ionicons does not draw. */
  icon: keyof typeof Ionicons.glyphMap | "jar";
  /** The circle behind the icon, deep, and the icon on it, bright. */
  tile: string;
  glyph: string;
  /** A built screen to open, or the intro page for one that is not built. */
  route?: "/earn" | "/swap";
  intro?: Omit<FeatureIntroProps, "cta">;
  /** Hidden unless this feature flag is on. */
  flag?: "swap";
}

export const DO_MORE_ITEMS: DoMoreItem[] = [
  {
    key: "jars",
    section: "Accounts",
    title: "Jars",
    description: "Set money aside for bills, plans and everything in between.",
    icon: "jar",
    tile: "#163300",
    glyph: "#9FE870",
    intro: {
      illustration: "jar",
      headline: "Set money aside in a jar",
      benefits: [
        {
          icon: "pie-chart-outline",
          title: "Keep it apart from spending",
          body: "Money in a jar stays out of your everyday balance.",
        },
        {
          icon: "flag-outline",
          title: "Save towards a goal",
          body: "Rent, a trip, or just a rainy day. Give each jar a target.",
        },
        {
          icon: "swap-horizontal",
          title: "Move it when you are ready",
          body: "Send it back to your account whenever you want to use it.",
        },
      ],
    },
  },
  {
    key: "group-spending",
    section: "Accounts",
    title: "Group spending",
    description: "One pot, shared by everyone you invite.",
    icon: "people-outline",
    tile: "#163300",
    glyph: "#9FE870",
    intro: {
      illustration: "group",
      headline: "Spend with others",
      benefits: [
        {
          icon: "person-add-outline",
          title: "Invite up to 4 people",
          body: "A group has up to 5 people, including you.",
        },
        {
          icon: "card-outline",
          title: "Everyone spends from one pot",
          body: "Trips, flatmates, family costs. Everyone sees every payment.",
        },
        {
          icon: "shield-checkmark-outline",
          title: "You stay in control",
          body: "Only you can send or withdraw the group's money.",
        },
      ],
    },
  },
  {
    key: "earn",
    section: "Grow",
    title: "Earn",
    description: "Put dollars you are not spending to work.",
    icon: "trending-up-outline",
    tile: "#2B1747",
    glyph: "#C9A8FF",
    route: "/earn",
  },
  {
    key: "swap",
    section: "Grow",
    title: "Swap",
    description: "Move between dollars and the assets you hold.",
    icon: "repeat-outline",
    tile: "#0B2A4A",
    glyph: "#7CC4FF",
    route: "/swap",
    flag: "swap",
  },
  {
    key: "scheduled-transfers",
    section: "Automate",
    title: "Scheduled transfers",
    description: "Send money on a later date, or every month.",
    icon: "calendar-outline",
    tile: "#3A1414",
    glyph: "#FFB38A",
    intro: {
      illustration: "calendar",
      headline: "Set scheduled payments",
      benefits: [
        {
          icon: "calendar-outline",
          title: "Set it up now, send it later",
          body: "Get a payment ready to go out on the date you choose.",
        },
        {
          icon: "refresh-outline",
          title: "Repeat payments automatically",
          body: "Rent, allowances and bills go out on their own.",
        },
        {
          icon: "trending-up-outline",
          title: "Today's rate, when it sends",
          body: "Each payment uses the rate on the day it goes out.",
        },
      ],
    },
  },
];

export function doMoreItem(key: string): DoMoreItem | undefined {
  return DO_MORE_ITEMS.find((item) => item.key === key);
}
