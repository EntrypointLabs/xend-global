import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openModal, type ModalHandle } from "../modal";

let modal: ModalHandle;
let cancel = vi.fn<() => void>();
let trigger: HTMLButtonElement;
let root: ShadowRoot;

beforeEach(() => {
  vi.useFakeTimers();
  trigger = document.createElement("button");
  document.body.appendChild(trigger);
  trigger.focus();
  cancel = vi.fn();
  modal = openModal({
    doc: document,
    theme: "light",
    onConfirm: vi.fn(),
    onCancel: cancel,
  });
  root = document.querySelector("[data-xend-checkout]")!.shadowRoot!;
});
afterEach(() => {
  modal.close();
  vi.runAllTimers();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("SDK modal keyboard and dismissal behavior", () => {
  it("focuses the named dialog and restores its trigger when closed", () => {
    expect(root.activeElement?.getAttribute("role")).toBe("dialog");
    expect(root.activeElement?.getAttribute("aria-label")).toBe(
      "Pay with Xend",
    );
    modal.close();
    expect(document.activeElement).toBe(trigger);
  });

  it("cycles keyboard focus inside the sheet", () => {
    modal.showConfirm({
      merchantDisplayName: "Chowderr",
      displayCurrency: "USD",
      displayAmountMinor: "100",
    });
    const controls = root.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    const first = controls[0]!;
    const last = controls[controls.length - 1]!;
    last.focus();
    last.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(root.activeElement).toBe(first);
    first.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(root.activeElement).toBe(last);
  });

  it("allows Escape to cancel before Checkout starts", () => {
    root.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not report backdrop or Escape cancellation after handoff", () => {
    modal.showWaiting();
    root
      .querySelector("[data-close]")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    root.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(cancel).not.toHaveBeenCalled();
    expect(root.textContent).toContain("Waiting for confirmation");
  });
});
