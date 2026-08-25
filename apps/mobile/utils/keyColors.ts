/**
 * Icon colours for the key types.
 *
 * Colour lives on the glyph only. Xend's surfaces stay monochrome, so these are
 * the same treatment the settings list already gives its icons rather than a
 * new tinted-panel language.
 *
 * Recovery keys cycle through a palette by position so two email keys can be
 * told apart at a glance, which is the one thing their rows would otherwise
 * share.
 */
export const KEY_COLORS = {
  passkey: "#0080FF",
  device: "#7C5CFF",
} as const;

const RECOVERY_PALETTE = ["#7C5CFF", "#E255A1", "#FF8A1F"] as const;

export function recoveryKeyColor(index: number): string {
  return RECOVERY_PALETTE[index % RECOVERY_PALETTE.length];
}
