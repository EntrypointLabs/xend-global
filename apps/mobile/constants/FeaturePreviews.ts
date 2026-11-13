import type { FeatureBenefit } from "@/components/ui/layout/FeaturePreviewScreen";

/**
 * Copy for features the Consumer cannot use yet.
 *
 * Forward-looking claims, so they live in one file rather than inline in the
 * screens: everything here is a promise the product has to keep, and it needs
 * to be reviewable in one place before a build ships.
 */

export const PRYDD_PLUS_BENEFITS: FeatureBenefit[] = [
  {
    icon: "flash",
    iconColor: "#34C759",
    title: "Free transactions",
    description: "Use Prydd without paying Solana network fees.",
  },
  {
    icon: "shield",
    iconColor: "#0A84FF",
    title: "Hide my wallet",
    description: "Send and receive without revealing your wallet address.",
  },
  {
    icon: "business",
    iconColor: "#AF52DE",
    title: "Virtual bank account",
    description: "Send and receive bank transfers with Prydd.",
  },
  {
    icon: "card",
    iconColor: "#FFFFFF",
    title: "Prydd Card",
    description:
      "A virtual card to spend stablecoins anywhere, with zero fees.",
  },
];

export const PRYDD_CARD_BENEFITS: FeatureBenefit[] = [
  {
    icon: "flash",
    iconColor: "#34C759",
    title: "Spend what you already hold",
    description:
      "Pay directly from your Prydd balance, with no top up beforehand.",
  },
  {
    icon: "globe",
    iconColor: "#0A84FF",
    title: "Works anywhere",
    description: "A virtual card for online and in-store payments.",
  },
  {
    icon: "phone-portrait",
    iconColor: "#FF9500",
    title: "Add it to your phone",
    description: "Tap to pay from your wallet app once the card is issued.",
  },
  {
    icon: "lock-closed",
    iconColor: "#FFFFFF",
    title: "Freeze it anytime",
    description: "Turn the card off from Prydd the moment you need to.",
  },
];
