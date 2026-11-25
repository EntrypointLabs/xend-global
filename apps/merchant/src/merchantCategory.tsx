import type { ReactNode } from "react";

export const MERCHANT_CATEGORIES = [
  ["shopping", "Shopping"],
  ["food_drink", "Food & drink"],
  ["groceries", "Groceries"],
  ["transport", "Transport"],
  ["travel", "Travel"],
  ["entertainment", "Entertainment"],
  ["health", "Health"],
  ["services", "Services"],
  ["bills", "Bills"],
  ["other", "Other"],
] as const;

export type MerchantCategory = (typeof MERCHANT_CATEGORIES)[number][0];

const LABELS = Object.fromEntries(MERCHANT_CATEGORIES) as Record<
  MerchantCategory,
  string
>;

export function categoryLabel(category: MerchantCategory): string {
  return LABELS[category] ?? LABELS.other;
}

export function isMerchantCategory(value: string): value is MerchantCategory {
  return Object.hasOwn(LABELS, value);
}

const GLYPHS: Record<MerchantCategory, ReactNode> = {
  shopping: (
    <>
      <path d="M5 8h14l-1 12.5H6z" />
      <path d="M9 10.5V7a3 3 0 0 1 6 0v3.5" />
    </>
  ),
  food_drink: (
    <>
      <path d="M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3" />
      <path d="M17 21V3c-2.2 1.2-3.5 3.6-3.5 6.5V14H17" />
    </>
  ),
  groceries: (
    <>
      <path d="M2.5 4h2.6l2.3 11h11l2.1-8H6.2" />
      <circle cx="9" cy="19.5" r="1.3" />
      <circle cx="17" cy="19.5" r="1.3" />
    </>
  ),
  transport: (
    <>
      <path d="M4 16.5V12l2-5.2A2 2 0 0 1 7.9 5.5h8.2a2 2 0 0 1 1.9 1.3L20 12v4.5" />
      <path d="M3 12h18v4.5H3zM6 16.5V19M18 16.5V19M6.5 14.2h1M16.5 14.2h1" />
    </>
  ),
  travel: (
    <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
  ),
  entertainment: (
    <>
      <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h14a1.5 1.5 0 0 1 1.5 1.5V10a2 2 0 0 0 0 4v2.5A1.5 1.5 0 0 1 19 18H5a1.5 1.5 0 0 1-1.5-1.5V14a2 2 0 0 0 0-4z" />
      <path d="M14.5 6v2.2M14.5 10.9v2.2M14.5 15.8V18" />
    </>
  ),
  health: (
    <>
      <path d="M12 20.5S3.5 15.6 3.5 9.4A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 8.5 2.2c0 6.2-8.5 11.1-8.5 11.1z" />
      <path d="M6.5 12.5h3l1.5-2.5 2 4.5 1.5-2h3" />
    </>
  ),
  services: (
    <path d="M14.7 6.3a4 4 0 0 0-5.3 5.2l-6 6a1.6 1.6 0 0 0 2.3 2.3l6-6a4 4 0 0 0 5.2-5.3l-2.6 2.6-2.2-.6-.6-2.2z" />
  ),
  bills: (
    <>
      <path d="M6 3h12v18l-2.4-1.6L13.2 21 12 20l-1.2 1-2.4-1.6L6 21z" />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" />
    </>
  ),
  other: (
    <>
      <path d="M3.5 9.5 5 4.5h14l1.5 5" />
      <path d="M3.5 9.5a2.8 2.8 0 0 0 5.67 0 2.8 2.8 0 0 0 5.66 0 2.8 2.8 0 0 0 5.67 0" />
      <path d="M5 12v8.5h14V12M10 20.5v-5h4v5" />
    </>
  ),
};

export function CategoryIcon({
  category,
  size = 20,
}: {
  category: MerchantCategory;
  size?: number;
}) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPHS[category] ?? GLYPHS.other}
    </svg>
  );
}
