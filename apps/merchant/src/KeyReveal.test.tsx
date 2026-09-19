// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { KeyReveal } from "./KeyReveal";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("new API key disclosure", () => {
  it("reports successful copying only after the clipboard accepts the key", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<KeyReveal secret="example-test-key" onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy key" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Key copied"),
    );
    expect(writeText).toHaveBeenCalledWith("example-test-key");
  });

  it("offers manual copying when clipboard permission is denied", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) },
    });
    render(<KeyReveal secret="example-test-key" onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy key" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Select and copy",
      ),
    );
    expect(screen.getByRole("status").textContent).not.toContain("Key copied");
  });

  it("removes the secret from the view when dismissed", () => {
    function Host() {
      const [secret, setSecret] = useState("example-test-key");
      return secret ? (
        <KeyReveal secret={secret} onDismiss={() => setSecret("")} />
      ) : (
        <p>Key hidden</p>
      );
    }
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("example-test-key")).toBeNull();
    expect(screen.getByText("Key hidden")).toBeTruthy();
  });
});
