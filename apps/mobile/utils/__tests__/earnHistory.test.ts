import { earnBars, formatEarnedMinor } from "@/utils/earn";

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
  it("gives a bar per day for 7D, each the rise since the last snapshot", () => {
    const bars = earnBars(
      [
        point("2026-11-22", 0),
        point("2026-11-23", 0.01),
        point("2026-11-25", 0.04),
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
      0, 0, 0, 0, 0.01, 0, 0.03,
    ]);
  });

  it("counts a fall as nothing", () => {
    const bars = earnBars(
      [point("2026-11-24", 0.05), point("2026-11-25", 0.02)],
      "7d",
      today
    );
    expect(bars.every((b) => b.earned === 0)).toBe(true);
  });

  it("groups by month for 1Y and spans back to the first point for ALL", () => {
    expect(earnBars([], "1y", today)).toHaveLength(12);
    const all = earnBars(
      [point("2026-09-30", 0), point("2026-10-31", 0.1)],
      "all",
      today
    );
    expect(all.map((b) => b.label)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(Number(all[1].earned.toFixed(2))).toBe(0.1);
  });
});
