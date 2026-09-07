import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { XendPayButton } from "../index";

const ORIGIN = "https://pay.xend.global";
const createIntent = () => Promise.resolve({ reference: "pi_react_1" });

describe("XendPayButton", () => {
  it("renders the core Pay with Xend button and fires onReady", () => {
    const onReady = vi.fn();
    const { container } = render(
      <XendPayButton
        checkoutOrigin={ORIGIN}
        createIntent={createIntent}
        onResult={() => {}}
        onReady={onReady}
      />,
    );
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toBe("Pay with Xend");
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("does not remount the button when a callback prop identity changes", () => {
    const { container, rerender } = render(
      <XendPayButton
        checkoutOrigin={ORIGIN}
        createIntent={createIntent}
        onResult={() => {}}
      />,
    );
    const first = container.querySelector("button");
    expect(first).not.toBeNull();

    rerender(
      <XendPayButton
        checkoutOrigin={ORIGIN}
        createIntent={createIntent}
        onResult={() => "a different function identity"}
      />,
    );
    const second = container.querySelector("button");
    expect(second).toBe(first);
  });

  it("accepts the default glass-sheet presentation and its apiBase", () => {
    const { container } = render(
      <XendPayButton
        checkoutOrigin={ORIGIN}
        apiBase="https://api.xend.test"
        presentation="modal"
        createIntent={createIntent}
        onResult={() => {}}
      />,
    );
    expect(container.querySelector("button")).not.toBeNull();
    // The sheet is drawn on click, so nothing is in the page until then.
    expect(document.querySelector("[data-xend-checkout]")).toBeNull();
  });

  it("forwards theme and presentation to the core button", () => {
    const { container, rerender } = render(
      <XendPayButton
        checkoutOrigin={ORIGIN}
        createIntent={createIntent}
        onResult={() => {}}
        theme="dark"
        presentation="redirect"
      />,
    );
    const first = container.querySelector("button");
    expect(first?.dataset["theme"]).toBe("dark");

    // A mount-time option change is the one thing that rebuilds the button.
    rerender(
      <XendPayButton
        checkoutOrigin={ORIGIN}
        createIntent={createIntent}
        onResult={() => {}}
        theme="light"
        presentation="redirect"
      />,
    );
    const second = container.querySelector("button");
    expect(second).not.toBe(first);
    expect(second?.dataset["theme"]).toBe("light");
  });
});
