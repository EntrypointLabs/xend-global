import { isSystemPromptOpen, withSystemPrompt } from "../systemPrompt";

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

  it("closes when the prompt throws", async () => {
    jest.setSystemTime(50_000);
    await expect(
      withSystemPrompt(() => Promise.reject(new Error("cancelled")))
    ).rejects.toThrow("cancelled");
    jest.setSystemTime(51_000);
    expect(isSystemPromptOpen()).toBe(false);
  });
});
