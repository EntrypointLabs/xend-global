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

export type ButtonState = "ready" | "loading" | "disabled" | "processing";

export interface RenderButtonOptions {
  onClick: () => void;
  onReady?: () => void;
}

export interface ButtonHandle {
  element: HTMLButtonElement;
  setState: (state: ButtonState) => void;
  destroy: () => void;
}

const CLASS_PREFIX = "xend-pay-";
const STYLE_ID = "xend-pay-style";

// Scoped, brand-baked CSS injected once. No Tailwind runtime, no global
// selectors; every rule is namespaced under the class prefix. The button
// is never green: green is reserved for the passkey success checkmark.
function styleText(): string {
  return `
.${CLASS_PREFIX}btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: ${MIN_TOUCH_TARGET}px;
  padding: 0 20px;
  border: 0;
  border-radius: 12px;
  background: ${BRAND_BLACK};
  color: ${LABEL_COLOR};
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
.${CLASS_PREFIX}btn:focus-visible {
  outline: 2px solid ${LABEL_COLOR};
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
.${CLASS_PREFIX}spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: ${LABEL_COLOR};
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

// The Xend mark as a tiny inline SVG: a rounded square (rx at 22% of its
// box) enclosing an "X". White on the brand background; never green.
function markSvg(): string {
  const rx = `${MARK_RADIUS_PERCENT}%`;
  return `<svg class="${CLASS_PREFIX}mark" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="0" y="0" width="20" height="20" rx="${rx}" ry="${rx}" fill="${LABEL_COLOR}"></rect><path d="M6 6 L14 14 M14 6 L6 14" stroke="${BRAND_BLACK}" stroke-width="2" stroke-linecap="round"></path></svg>`;
}

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = styleText();
  doc.head.appendChild(style);
}

/**
 * Render the brand-compliant Pay with Xend button into `mount`. Returns a
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
