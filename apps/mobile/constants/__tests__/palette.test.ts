import { readFileSync } from "fs";
import { join } from "path";

import { PALETTE, type ColorMode, type Palette } from "../palette";

function hslToHex(triplet: string): string {
  const [h, s, l] = triplet.replace(/%/g, "").split(/\s+/).map(Number) as [
    number,
    number,
    number,
  ];
  const sat = s / 100;
  const light = l / 100;
  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - chroma / 2;
  const [r, g, b] =
    h < 60
      ? [chroma, x, 0]
      : h < 120
        ? [x, chroma, 0]
        : h < 180
          ? [0, chroma, x]
          : h < 240
            ? [0, x, chroma]
            : h < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return (
    "#" +
    [r, g, b]
      .map((c) =>
        Math.round((c + m) * 255)
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
      .toUpperCase()
  );
}

function tokensIn(block: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    const key = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    tokens[key] = hslToHex(value.trim());
  }
  return tokens;
}

describe("palette", () => {
  const css = readFileSync(join(__dirname, "../../global.css"), "utf8");
  const darkAt = css.indexOf(".dark:root");
  const blocks: Record<ColorMode, string> = {
    light: css.slice(css.indexOf(":root {"), darkAt),
    dark: css.slice(darkAt),
  };

  it.each(["light", "dark"] as const)("mirrors global.css in %s", (mode) => {
    expect(PALETTE[mode]).toEqual(tokensIn(blocks[mode]) as unknown as Palette);
  });
});
