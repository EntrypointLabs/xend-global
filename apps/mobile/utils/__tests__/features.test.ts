import type { FeatureName } from "@/constants/Features";
import {
  FEATURES_STORE,
  isFeatureEnabled,
  loadServerFeatures,
  type FeatureStore,
  type ServerFeatures,
} from "@/utils/features";

const ALL_ON: Record<FeatureName, boolean> = {
  swap: true,
  earnDeposits: true,
  hideMyWallet: true,
};

function memoryStore(initial?: string): FeatureStore & {
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(FEATURES_STORE, initial);
  return {
    values,
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
  };
}

const unreachable = () => Promise.reject(new Error("network down"));

describe("BUILD_FEATURES", () => {
  const original = process.env.EXPO_PUBLIC_ENABLE_SWAP;
  afterEach(() => {
    process.env.EXPO_PUBLIC_ENABLE_SWAP = original;
  });

  async function buildWith(value: string | undefined): Promise<boolean> {
    if (value === undefined) delete process.env.EXPO_PUBLIC_ENABLE_SWAP;
    else process.env.EXPO_PUBLIC_ENABLE_SWAP = value;
    let swap = false;
    await jest.isolateModulesAsync(async () => {
      swap = (await import("@/constants/Features")).BUILD_FEATURES.swap;
    });
    return swap;
  }

  it("turns a feature on when its variable is not set", async () => {
    expect(await buildWith(undefined)).toBe(true);
  });

  it("turns a feature off only for an explicit false", async () => {
    expect(await buildWith("false")).toBe(false);
    expect(await buildWith("true")).toBe(true);
    expect(await buildWith("")).toBe(true);
  });
});

describe("isFeatureEnabled", () => {
  it("follows the build until the server has answered", () => {
    expect(isFeatureEnabled("swap", null, ALL_ON)).toBe(true);
    expect(isFeatureEnabled("swap", undefined, ALL_ON)).toBe(true);
  });

  it("hides a feature the server switched off", () => {
    expect(isFeatureEnabled("swap", { swap: false }, ALL_ON)).toBe(false);
  });

  it("never shows a feature the build compiled out", () => {
    const build = { ...ALL_ON, swap: false };

    expect(isFeatureEnabled("swap", { swap: true }, build)).toBe(false);
  });

  it("allows a feature the server does not mention", () => {
    expect(isFeatureEnabled("hideMyWallet", { swap: false }, ALL_ON)).toBe(
      true
    );
  });
});

describe("loadServerFeatures", () => {
  it("returns the live answer and remembers it", async () => {
    const store = memoryStore();
    const live: ServerFeatures = {
      swap: false,
      earnDeposits: true,
      hideMyWallet: true,
    };

    await expect(loadServerFeatures(async () => live, store)).resolves.toEqual(
      live
    );
    expect(JSON.parse(store.values.get(FEATURES_STORE)!)).toEqual(live);
  });

  it("keeps a switch off through a launch with no network", async () => {
    const store = memoryStore(JSON.stringify({ swap: false }));

    await expect(loadServerFeatures(unreachable, store)).resolves.toEqual({
      swap: false,
    });
  });

  it("answers null on a device that has never heard from the server", async () => {
    await expect(
      loadServerFeatures(unreachable, memoryStore())
    ).resolves.toBeNull();
  });

  it("ignores a stored answer it cannot read", async () => {
    for (const stored of ["not json", JSON.stringify({ swap: "off" })]) {
      await expect(
        loadServerFeatures(unreachable, memoryStore(stored))
      ).resolves.toBeNull();
    }
  });

  it("still returns the live answer when it cannot be remembered", async () => {
    const store: FeatureStore = {
      getItem: async () => null,
      setItem: () => Promise.reject(new Error("disk full")),
    };

    await expect(
      loadServerFeatures(async () => ({ swap: false }), store)
    ).resolves.toEqual({ swap: false });
  });
});
