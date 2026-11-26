import { homeNudges, type NudgeInputs } from "@/utils/homeNudges";

const base: NudgeInputs = {
  cashUsd: 120,
  earnUsd: 0,
  earnDepositsEnabled: true,
  earnApy: 4.37,
  currency: "NGN",
  symbol: "₦",
  perUsd: 1530,
};

describe("homeNudges", () => {
  it("offers Earn and bank payouts to a funded Nigerian account", () => {
    expect(homeNudges(base)).toEqual([
      {
        key: "earn",
        title: "Earn up to 4.37% per year",
        subtitle: "Put your dollars into Earn",
      },
      {
        key: "bank-payout",
        title: "Send to any bank",
        subtitle: "$1 = ₦1,530.00 today",
      },
    ]);
  });

  it("offers nothing while there is nothing to put to work", () => {
    expect(homeNudges({ ...base, cashUsd: 0 })).toEqual([]);
    expect(homeNudges({ ...base, cashUsd: null })).toEqual([]);
  });

  it("keeps Earn behind what is new once money is in it", () => {
    const keys = (input: NudgeInputs) => homeNudges(input).map((n) => n.key);
    expect(keys({ ...base, earnUsd: 10 })).toEqual(["bank-payout", "earn"]);
  });

  it("never leaves a funded account's slot empty", () => {
    expect(
      homeNudges({
        ...base,
        earnUsd: 25.53,
        currency: "GBP",
        symbol: "£",
        perUsd: 0.76,
      }).map((n) => n.key)
    ).toEqual(["earn"]);
  });

  it("names Earn without a rate when none is known", () => {
    expect(homeNudges({ ...base, earnApy: 0 })[0].title).toBe(
      "Earn on your dollars"
    );
  });

  it("offers no Earn while deposits are off", () => {
    const keys = (input: NudgeInputs) => homeNudges(input).map((n) => n.key);
    expect(keys({ ...base, earnDepositsEnabled: false })).toEqual([
      "bank-payout",
    ]);
  });

  it("offers bank payouts only where the card is in naira and priced", () => {
    const keys = (input: NudgeInputs) => homeNudges(input).map((n) => n.key);
    expect(
      keys({ ...base, currency: "GBP", symbol: "£", perUsd: 0.76 })
    ).toEqual(["earn"]);
    expect(keys({ ...base, perUsd: undefined })).toEqual(["earn"]);
  });
});
