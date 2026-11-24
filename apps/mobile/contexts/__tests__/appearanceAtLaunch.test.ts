/*
 * The saved Light or Dark has to hold from the first frame of a cold start.
 *
 * This runs nativewind's real colour-scheme code against a phone that is in
 * the other mode and an app that is not in the foreground, which is what a
 * cold start behind a Face ID prompt looks like. That library ignores the
 * phone's report of a mode change unless the app is in the foreground, so
 * without the app setting its own copy the first screen draws in the phone's
 * mode.
 */

// The library short-circuits under NODE_ENV=test, which hides the very thing
// this is about. Set before anything loads it.
process.env.NODE_ENV = "production";

const phone = {
  mode: "dark" as "light" | "dark",
  appState: "inactive",
  changeListeners: [] as ((state: { colorScheme: string }) => void)[],
};

jest.mock("react-native", () => ({
  Appearance: {
    getColorScheme: () => phone.mode,
    // The phone takes the override and reports it back, as iOS does.
    setColorScheme: (mode: "light" | "dark") => {
      phone.mode = mode;
      phone.changeListeners.forEach((listener) =>
        listener({ colorScheme: mode })
      );
    },
    addChangeListener: (listener: (state: { colorScheme: string }) => void) => {
      phone.changeListeners.push(listener);
      return { remove: () => undefined };
    },
  },
  AppState: {
    get currentState() {
      return phone.appState;
    },
    addEventListener: () => ({ remove: () => undefined }),
  },
  Platform: { OS: "ios", constants: { reactNativeVersion: { minor: 82 } } },
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(false),
    addEventListener: () => ({ remove: () => undefined }),
  },
}));

jest.mock("nativewind", () => ({
  colorScheme: jest.requireActual(
    "react-native-css-interop/dist/runtime/native/appearance-observables"
  ).colorScheme,
}));

const saved: Record<string, string> = {};
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: (key: string) => Promise.resolve(saved[key] ?? null),
    setItem: (key: string, value: string) => {
      saved[key] = value;
      return Promise.resolve();
    },
  },
}));

jest.mock("@/utils/appIcon", () => ({ applyAppIcon: jest.fn() }));

describe("the saved appearance at a cold start", () => {
  it("draws Light on a dark phone before the app reaches the foreground", async () => {
    saved["appearance.v1"] = JSON.stringify({ mode: "light" });
    const { colorScheme } = jest.requireActual(
      "react-native-css-interop/dist/runtime/native/appearance-observables"
    );
    // What the first screen would draw from before the choice is read.
    expect(colorScheme.get()).toBe("dark");

    const { loadAppearance } = await import("../AppearanceContext");
    await expect(loadAppearance()).resolves.toMatchObject({ mode: "light" });

    expect(phone.appState).toBe("inactive");
    expect(colorScheme.get()).toBe("light");
  });
});
