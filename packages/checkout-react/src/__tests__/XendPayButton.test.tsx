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
});
