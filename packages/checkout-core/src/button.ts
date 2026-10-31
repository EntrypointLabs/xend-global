import {
  BRAND_BLACK,
  FONT_STACK,
  FONT_WEIGHT,
  LABEL_COLOR,
  LABEL_TEXT,
  LETTER_SPACING,
  MARK_RADIUS_PERCENT,
  MIN_TOUCH_TARGET,
} from "./brand";
import type { ButtonTheme } from "./types";

export type ButtonState = "ready" | "loading" | "disabled" | "processing";

export interface RenderButtonOptions {
  onClick: () => void;
  onReady?: () => void;
  theme?: ButtonTheme;
}

export interface ButtonHandle {
  element: HTMLButtonElement;
  setState: (state: ButtonState) => void;
  destroy: () => void;
}

const CLASS_PREFIX = "prydd-pay-";
const STYLE_ID = "prydd-pay-style";

// Scoped, brand-baked CSS injected once. No Tailwind runtime, no global
// selectors; every rule is namespaced under the class prefix. The button
// is never green: green is reserved for the passkey success checkmark.
// The dark theme swaps the two brand tokens so the button stays the same
// shape on a dark page; nothing else changes.
function styleText(): string {
  const inverted = `--${CLASS_PREFIX}bg: ${LABEL_COLOR}; --${CLASS_PREFIX}fg: ${BRAND_BLACK};`;
  return `
.${CLASS_PREFIX}btn {
  --${CLASS_PREFIX}bg: ${BRAND_BLACK};
  --${CLASS_PREFIX}fg: ${LABEL_COLOR};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: ${MIN_TOUCH_TARGET}px;
  padding: 0 20px;
  border: 0;
  border-radius: 12px;
  background: var(--${CLASS_PREFIX}bg);
  color: var(--${CLASS_PREFIX}fg);
  font-family: ${FONT_STACK};
  font-weight: ${FONT_WEIGHT};
  font-size: 16px;
  letter-spacing: ${LETTER_SPACING};
  line-height: 1;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
  user-select: none;
}
.${CLASS_PREFIX}btn[data-theme='dark'] { ${inverted} }
@media (prefers-color-scheme: dark) {
  .${CLASS_PREFIX}btn[data-theme='auto'] { ${inverted} }
}
.${CLASS_PREFIX}btn:focus-visible {
  outline: 2px solid var(--${CLASS_PREFIX}fg);
  outline-offset: 2px;
}
.${CLASS_PREFIX}btn[data-state='disabled'],
.${CLASS_PREFIX}btn[data-state='loading'],
.${CLASS_PREFIX}btn[data-state='processing'] {
  cursor: default;
  opacity: 0.7;
}
.${CLASS_PREFIX}mark {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}
.${CLASS_PREFIX}mark rect { fill: var(--${CLASS_PREFIX}fg); }
.${CLASS_PREFIX}mark path { fill: var(--${CLASS_PREFIX}bg); }
.${CLASS_PREFIX}spinner {
  width: 16px;
  height: 16px;
  border: 2px solid color-mix(in srgb, var(--${CLASS_PREFIX}fg) 35%, transparent);
  border-top-color: var(--${CLASS_PREFIX}fg);
  border-radius: 50%;
  animation: ${CLASS_PREFIX}spin 0.7s linear infinite;
}
@keyframes ${CLASS_PREFIX}spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .${CLASS_PREFIX}spinner { animation: none; }
}
`;
}

// The Prydd mark as a tiny inline SVG: a rounded square (rx at 22% of its
// box) enclosing the symbol. Label colour on the brand background; never green.
function markSvg(): string {
  const rx = `${MARK_RADIUS_PERCENT}%`;
  return `<svg class="${CLASS_PREFIX}mark" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="0" y="0" width="20" height="20" rx="${rx}" ry="${rx}"></rect><path transform="translate(3.976 3.916) scale(.06024)" d="M 48 40 L 94 40 C 102 40 107 35 113 29 L 119 23 C 123 19 127 18 135 18 L 180 18 L 180 158 C 180 163 177 166 172 166 L 114 166 C 112 166 110 167 108 169 L 94 182 C 92 184 90 184 87 184 L 28 184 C 23 184 20 181 20 176 L 20 91 C 20 85 24 82 30 82 L 58 82 L 58 144 C 58 147 60 149 63 149 L 86 149 C 89 149 91 148 94 145 L 110 129 C 112 127 115 126 119 126 L 143 126 L 143 59 L 133 59 C 125 59 119 65 114 71 C 109 76 104 78 96 78 L 58 78 C 45 78 36 58 36 50 C 36 44 42 40 48 40 Z"></path></svg>`;
}

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = styleText();
  doc.head.appendChild(style);
}

/**
 * Render the brand-compliant Pay with Prydd button into `mount`. Returns a
 * handle to toggle state and tear it down. Fires onReady once the button
 * is in the DOM and interactive.
 */
export function renderButton(
  mount: HTMLElement,
  options: RenderButtonOptions,
): ButtonHandle {
  const doc = mount.ownerDocument;
  ensureStyle(doc);

  const button = doc.createElement("button");
  button.type = "button";
  button.className = `${CLASS_PREFIX}btn`;
  button.setAttribute("aria-label", LABEL_TEXT);
  button.dataset["state"] = "ready";
  button.dataset["theme"] = options.theme ?? "auto";

  const label = doc.createElement("span");
  label.className = `${CLASS_PREFIX}label`;
  label.textContent = LABEL_TEXT;

  const renderContent = (state: ButtonState): void => {
    button.innerHTML = "";
    const spinning = state === "loading" || state === "processing";
    if (spinning) {
      const spinner = doc.createElement("span");
      spinner.className = `${CLASS_PREFIX}spinner`;
      spinner.setAttribute("aria-hidden", "true");
      button.appendChild(spinner);
    } else {
      const mark = doc.createElement("span");
      mark.innerHTML = markSvg();
      const svg = mark.firstElementChild;
      if (svg) button.appendChild(svg);
    }
    button.appendChild(label);
  };

  renderContent("ready");

  const setState = (state: ButtonState): void => {
    button.dataset["state"] = state;
    button.disabled = state === "disabled";
    button.setAttribute("aria-busy", String(state === "processing"));
    renderContent(state);
  };

  button.addEventListener("click", () => {
    if (button.dataset["state"] === "disabled") return;
    options.onClick();
  });

  mount.appendChild(button);
  options.onReady?.();

  const destroy = (): void => {
    button.remove();
  };

  return { element: button, setState, destroy };
}
