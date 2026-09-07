import { authenticateWithRetry } from "@/utils/passkeyCeremony";

const emptyBody = () => new SyntaxError("Unexpected end of JSON input");

describe("authenticateWithRetry", () => {
  it("returns the first answer when the ceremony succeeds", async () => {
    const authenticate = jest.fn().mockResolvedValue({ id: "user-1" });
    const beforeRetry = jest.fn();

    await expect(
      authenticateWithRetry(authenticate, beforeRetry)
    ).resolves.toEqual({
      id: "user-1",
    });
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(beforeRetry).not.toHaveBeenCalled();
  });

  it("retries once after an empty response, closing any half-open session first", async () => {
    const order: string[] = [];
    const authenticate = jest
      .fn()
      .mockImplementationOnce(async () => {
        order.push("first");
        throw emptyBody();
      })
      .mockImplementationOnce(async () => {
        order.push("second");
        return { id: "user-1" };
      });
    const beforeRetry = jest.fn(async () => {
      order.push("beforeRetry");
    });

    await expect(
      authenticateWithRetry(authenticate, beforeRetry)
    ).resolves.toEqual({
      id: "user-1",
    });
    expect(order).toEqual(["first", "beforeRetry", "second"]);
  });

  it("gives up after a second empty response", async () => {
    const authenticate = jest.fn().mockRejectedValue(emptyBody());

    await expect(
      authenticateWithRetry(authenticate, async () => {})
    ).rejects.toBeInstanceOf(SyntaxError);
    expect(authenticate).toHaveBeenCalledTimes(2);
  });

  it("does not retry any other failure", async () => {
    const authenticate = jest.fn().mockRejectedValue(new Error("cancelled"));
    const beforeRetry = jest.fn();

    await expect(
      authenticateWithRetry(authenticate, beforeRetry)
    ).rejects.toThrow("cancelled");
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(beforeRetry).not.toHaveBeenCalled();
  });

  it("never retries a registration", async () => {
    const authenticate = jest.fn().mockRejectedValue(emptyBody());

    await expect(authenticateWithRetry(authenticate)).rejects.toBeInstanceOf(
      SyntaxError
    );
    expect(authenticate).toHaveBeenCalledTimes(1);
  });
});
