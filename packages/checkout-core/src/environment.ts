export type EnvironmentReason = "webview" | "opera_mini" | "no_webauthn";

export interface EnvironmentResult {
  canPopup: boolean;
  reason?: EnvironmentReason;
}

export interface EnvironmentProbe {
  userAgent?: string;
  hasWebAuthn?: boolean;
}

// Heuristic markers for in-app webviews where a popup either cannot open
// or is severed from its opener. Tuned to the browsers that dominate the
// pilot's traffic; expected to be refined with pilot telemetry.
const WEBVIEW_MARKERS = [
  "Instagram",
  "FBAN",
  "FBAV",
  "FB_IAB",
  "WhatsApp",
  "Line/",
  "Twitter",
  "MicroMessenger", // WeChat
  "Snapchat",
  "TikTok",
  "musical_ly",
  "GSA/", // Google app in-app browser
];

function isAndroidWebView(ua: string): boolean {
  // Android WebView advertises `; wv)` and/or a `Version/x.x` token
  // alongside Chrome, which a real Chrome tab does not carry.
  if (/;\s*wv[;)]/.test(ua)) return true;
  if (
    /Android/.test(ua) &&
    /Version\/\d+\.\d+/.test(ua) &&
    /Chrome\//.test(ua)
  ) {
    return true;
  }
  return false;
}

/**
 * Decide whether the popup flow is safe in this environment. A pure
 * function of the user agent and WebAuthn availability so it is unit
 * testable by injecting a fake probe. Any webview, Opera Mini, or a
 * runtime without WebAuthn returns canPopup:false with the reason, and
 * the caller falls back to the full-page redirect flow.
 */
export function detectEnvironment(
  probe: EnvironmentProbe = {},
): EnvironmentResult {
  const ua =
    probe.userAgent ??
    (typeof navigator !== "undefined" ? navigator.userAgent : "");

  if (/Opera Mini/i.test(ua)) {
    return { canPopup: false, reason: "opera_mini" };
  }

  if (WEBVIEW_MARKERS.some((m) => ua.includes(m)) || isAndroidWebView(ua)) {
    return { canPopup: false, reason: "webview" };
  }

  const hasWebAuthn =
    probe.hasWebAuthn ??
    (typeof window !== "undefined" && "PublicKeyCredential" in window);
  if (!hasWebAuthn) {
    return { canPopup: false, reason: "no_webauthn" };
  }

  return { canPopup: true };
}
