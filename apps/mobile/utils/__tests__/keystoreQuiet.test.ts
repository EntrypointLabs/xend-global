import { onlineManager } from "@tanstack/react-query";

import { withKeystoreQuiet } from "../../modules/hardware-key/src/keystoreQuiet";

/**
 * The failure this guards against is a Consumer stuck with an app that never
 * fetches anything again, which would be a worse bug than the one it fixes.
 */
describe("withKeystoreQuiet", () => {
  beforeEach(() => onlineManager.setOnline(true));
  afterEach(() => onlineManager.setOnline(true));

  it("holds fetching for the length of the signature", async () => {
    let duringPrompt: boolean | null = null;

    await withKeystoreQuiet(async () => {
      duringPrompt = onlineManager.isOnline();
    });

    expect(duringPrompt).toBe(false);
    expect(onlineManager.isOnline()).toBe(true);
  });

  it("restores fetching when the signature fails", async () => {
    // A refused fingerprint throws, and it is the common case rather than the
    // rare one.
    await expect(
      withKeystoreQuiet(() => Promise.reject(new Error("refused")))
    ).rejects.toThrow("refused");

    expect(onlineManager.isOnline()).toBe(true);
  });

  it("keeps holding while a second signature overlaps the first", async () => {
    let release!: () => void;
    const outer = withKeystoreQuiet(
      () => new Promise<void>((resolve) => (release = resolve))
    );

    await withKeystoreQuiet(async () => {});
    // The inner one finished, but the outer prompt is still up, so releasing
    // here would restore exactly the traffic that evicts its operation.
    expect(onlineManager.isOnline()).toBe(false);

    release();
    await outer;
    expect(onlineManager.isOnline()).toBe(true);
  });

  it("returns what the signature returned", async () => {
    await expect(withKeystoreQuiet(async () => "stamp")).resolves.toBe("stamp");
  });
});
