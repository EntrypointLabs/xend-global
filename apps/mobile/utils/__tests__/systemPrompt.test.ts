import { privacyCover } from "@/modules/privacy-cover/src";
import { isSystemPromptOpen, withSystemPrompt } from "../systemPrompt";

jest.mock("@/modules/privacy-cover/src", () => ({
  privacyCover: { beginPrompt: jest.fn(), endPrompt: jest.fn() },
}));

describe("system prompt tracking", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("is open while the prompt is up and for a beat after it is answered", async () => {
    jest.setSystemTime(10_000);
    expect(isSystemPromptOpen()).toBe(false);

    let answer!: () => void;
    const pending = withSystemPrompt(
      () => new Promise<void>((resolve) => (answer = resolve))
    );
    expect(isSystemPromptOpen()).toBe(true);

    answer();
    await pending;
    expect(isSystemPromptOpen()).toBe(true);

    jest.setSystemTime(10_700);
    expect(isSystemPromptOpen()).toBe(false);
  });

  it("tells the native cover when a prompt starts and when it is answered", async () => {
    jest.mocked(privacyCover.beginPrompt).mockClear();
    jest.mocked(privacyCover.endPrompt).mockClear();

    await withSystemPrompt(async () => {
      expect(privacyCover.beginPrompt).toHaveBeenCalledTimes(1);
      expect(privacyCover.endPrompt).not.toHaveBeenCalled();
    });
    expect(privacyCover.endPrompt).toHaveBeenCalledTimes(1);
  });

  it("closes when the prompt throws", async () => {
    jest.setSystemTime(50_000);
    await expect(
      withSystemPrompt(() => Promise.reject(new Error("cancelled")))
    ).rejects.toThrow("cancelled");
    jest.setSystemTime(51_000);
    expect(isSystemPromptOpen()).toBe(false);
  });
});
