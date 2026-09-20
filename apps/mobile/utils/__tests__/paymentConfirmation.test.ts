import { waitForPaymentOutcome } from "../paymentConfirmation";

describe("payment confirmation", () => {
  it("does not treat submission as success", async () => {
    const read = jest.fn().mockResolvedValue("settling");
    expect(await waitForPaymentOutcome(read, async () => {}, 2)).toBe(
      "pending"
    );
  });
  it("waits for confirmed settlement", async () => {
    const read = jest
      .fn()
      .mockResolvedValueOnce("settling")
      .mockResolvedValueOnce("succeeded");
    expect(await waitForPaymentOutcome(read, async () => {}, 2)).toBe(
      "succeeded"
    );
  });
  it("reports a network failure", async () => {
    expect(
      await waitForPaymentOutcome(
        async () => "failed",
        async () => {},
        2
      )
    ).toBe("failed");
  });
  it("leaves an unavailable outcome uncertain", async () => {
    await expect(
      waitForPaymentOutcome(async () => {
        throw new Error("offline");
      })
    ).rejects.toThrow("offline");
  });
});
