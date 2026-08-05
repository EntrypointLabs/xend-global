import { describe, expect, it } from "vitest";
import { detectEnvironment } from "../environment";

const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

describe("detectEnvironment", () => {
  it("allows popups in a normal mobile Chrome with WebAuthn", () => {
    expect(
      detectEnvironment({ userAgent: CHROME_ANDROID, hasWebAuthn: true }),
    ).toEqual({ canPopup: true });
  });

  it.each([
    ["Instagram", `${CHROME_ANDROID} Instagram 300.0.0`],
    ["Facebook", `${CHROME_ANDROID} [FBAN/FBIOS;FBAV/400.0]`],
    ["WhatsApp", `${CHROME_ANDROID} WhatsApp/2.24`],
    ["Line", `${CHROME_ANDROID} Line/13.0.0`],
    ["WeChat", `${CHROME_ANDROID} MicroMessenger/8.0`],
    [
      "Android WebView (; wv)",
      "Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36",
    ],
  ])("flags %s as a webview (no popup)", (_name, ua) => {
    expect(detectEnvironment({ userAgent: ua, hasWebAuthn: true })).toEqual({
      canPopup: false,
      reason: "webview",
    });
  });

  it("flags Opera Mini", () => {
    expect(
      detectEnvironment({
        userAgent: "Opera/9.80 (Android; Opera Mini/7.5) Presto/2.8",
        hasWebAuthn: true,
      }),
    ).toEqual({ canPopup: false, reason: "opera_mini" });
  });

  it("flags a runtime without WebAuthn", () => {
    expect(
      detectEnvironment({ userAgent: CHROME_ANDROID, hasWebAuthn: false }),
    ).toEqual({ canPopup: false, reason: "no_webauthn" });
  });
});
