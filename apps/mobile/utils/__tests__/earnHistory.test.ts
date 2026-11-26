import { earnBars, formatEarnedMinor, productEarnings } from "@/utils/earn";

const today = new Date("2026-11-25T12:00:00Z");
const point = (day: string, earned: number) => ({
  day,
  valueMinor: "0",
  earnedMinor: String(Math.round(earned * 1e6)),
});

describe("formatEarnedMinor", () => {
  it("reads rounding dust below zero as zero, not -0.00", () => {
    expect(formatEarnedMinor("-1")).toBe("0.00");
    expect(formatEarnedMinor("-4999")).toBe("0.00");
  });

  it("keeps real values and unknowns", () => {
    expect(formatEarnedMinor("30000")).toBe("0.03");
    expect(formatEarnedMinor("-50000")).toBe("-0.05");
    expect(formatEarnedMinor(null)).toBe("—");
  });
});

describe("earnBars", () => {
  it("gives 7D a bar per day holding the total earned by then", () => {
    const { bars, earnedInRange } = earnBars(
      [
        point("2026-11-18", 0.01),
        point("2026-11-22", 0.02),
        point("2026-11-23", 0.03),
        point("2026-11-25", 0.06),
      ],
      "7d",
      today
    );
    expect(bars.map((b) => b.label)).toEqual([
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
    ]);
    expect(bars.map((b) => Number(b.earned.toFixed(2)))).toEqual([
      0.01, 0.01, 0.01, 0.02, 0.03, 0.03, 0.06,
    ]);
    expect(Number(earnedInRange.toFixed(2))).toBe(0.05);
  });

  it("steps 30D in ten three-day bars", () => {
    const { bars } = earnBars([], "30d", today);
    expect(bars).toHaveLength(10);
    expect(bars[9].label).toBe("2026-11-25");
    expect(bars[8].label).toBe("2026-11-22");
  });

  it("uses month ends for 1Y and starts ALL at the first snapshot", () => {
    expect(earnBars([], "1y", today).bars).toHaveLength(12);
    const { bars, earnedInRange } = earnBars(
      [point("2026-09-30", 0), point("2026-10-31", 0.1)],
      "all",
      today
    );
    expect(bars.map((b) => b.label)).toEqual([
      "2026-09-30",
      "2026-10-31",
      "2026-11-25",
    ]);
    expect(Number(earnedInRange.toFixed(2))).toBe(0.1);
  });

  it("never draws more than twelve bars for ALL", () => {
    const { bars } = earnBars([point("2024-01-15", 0)], "all", today);
    expect(bars).toHaveLength(12);
    expect(bars[11].label).toBe("2026-11-25");
  });
});

describe("productEarnings", () => {
  const product = (
    id: "kamino" | "jupiter",
    positionMinor: string,
    extra: Record<string, string | null> = {}
  ) => ({
    id,
    provider: id,
    name: "Lending Yield",
    apy: 0.04,
    positionShares: positionMinor,
    positionMinor,
    withdrawableMinor: positionMinor,
    available: true,
    withdrawAvailable: true,
    updatedAt: "2026-11-25T00:00:00.000Z",
    ...extra,
  });
  const catalog = (products: ReturnType<typeof product>[]) => ({
    depositableMinor: "0",
    lifetimeMinor: "40000",
    lastSevenDaysMinor: "10000",
    products,
  });

  it("uses the product's own figures when the server sends them", () => {
    expect(
      productEarnings(
        catalog([
          product("jupiter", "15000000", {
            lifetimeMinor: "30000",
            lastSevenDaysMinor: "5000",
          }),
        ]),
        "jupiter"
      )
    ).toEqual({ lifetimeMinor: "30000", lastSevenDaysMinor: "5000" });
  });

  it("falls back to the totals while only this product holds money", () => {
    expect(
      productEarnings(
        catalog([product("jupiter", "15000000"), product("kamino", "0")]),
        "jupiter"
      )
    ).toEqual({ lifetimeMinor: "40000", lastSevenDaysMinor: "10000" });
  });

  it("stays unknown when the totals span more than one position", () => {
    expect(
      productEarnings(
        catalog([product("jupiter", "15000000"), product("kamino", "5000000")]),
        "jupiter"
      )
    ).toEqual({ lifetimeMinor: null, lastSevenDaysMinor: null });
  });
});
