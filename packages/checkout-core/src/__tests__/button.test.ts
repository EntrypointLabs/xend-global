import { afterEach, describe, expect, it, vi } from "vitest";
import { renderButton } from "../button";
import { BRAND_BLACK } from "../brand";

function container(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  document.getElementById("xend-pay-style")?.remove();
});

describe("renderButton", () => {
  it("renders a real, labelled button", () => {
    const mount = container();
    renderButton(mount, { onClick: () => {} });
    const button = mount.querySelector("button");
    expect(button).not.toBeNull();
    expect(button?.getAttribute("type")).toBe("button");
    expect(button?.getAttribute("aria-label")).toBe("Pay with Xend");
    expect(button?.textContent).toContain("Pay with Xend");
  });

  it("uses the brand background and is never green", () => {
    const mount = container();
    renderButton(mount, { onClick: () => {} });
    const style = document.getElementById("xend-pay-style");
    expect(style?.textContent).toContain(`background: ${BRAND_BLACK}`);
    // No green anywhere in the button styling.
    expect(style?.textContent?.toLowerCase()).not.toContain("green");
    expect(style?.textContent).not.toMatch(/#0*(f0|00ff00|008000)/i);
    // #0a0a0a, never pure black.
    expect(style?.textContent).not.toContain("#000000");
  });

  it("exposes the four states via data-state", () => {
    const mount = container();
    const handle = renderButton(mount, { onClick: () => {} });
    for (const state of [
      "ready",
      "loading",
      "disabled",
      "processing",
    ] as const) {
      handle.setState(state);
      expect(handle.element.dataset["state"]).toBe(state);
    }
    handle.setState("disabled");
    expect(handle.element.disabled).toBe(true);
    handle.setState("ready");
    expect(handle.element.disabled).toBe(false);
  });

  it("fires onReady once mounted and invokes onClick", () => {
    const mount = container();
    const onReady = vi.fn();
    const onClick = vi.fn();
    const handle = renderButton(mount, { onClick, onReady });
    expect(onReady).toHaveBeenCalledTimes(1);
    handle.element.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick while disabled", () => {
    const mount = container();
    const onClick = vi.fn();
    const handle = renderButton(mount, { onClick });
    handle.setState("disabled");
    handle.element.click();
    expect(onClick).not.toHaveBeenCalled();
  });
});
