// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { RevokeKey } from "./RevokeKey";

afterEach(cleanup);

it("requires confirmation and allows cancellation without revoking", () => {
  const onRevoke = vi.fn();
  render(<RevokeKey fingerprint="test…123" onRevoke={onRevoke} />);
  fireEvent.click(screen.getByRole("button", { name: "Revoke key test…123" }));
  expect(screen.getByText(/Existing Payments are not cancelled/)).toBeTruthy();
  expect(onRevoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByText("Confirm revocation")).toBeNull();
  expect(onRevoke).not.toHaveBeenCalled();
});

it("cannot start a revocation while a one-time secret is still revealed", () => {
  const onRevoke = vi.fn();
  render(
    <RevokeKey fingerprint="test…123" onRevoke={onRevoke} disabled={true} />,
  );
  const trigger = screen.getByRole("button", {
    name: "Revoke key test…123",
  }) as HTMLButtonElement;
  expect(trigger.disabled).toBe(true);
  fireEvent.click(trigger);
  expect(screen.queryByText(/Existing Payments are not cancelled/)).toBeNull();
  expect(onRevoke).not.toHaveBeenCalled();
});

it("prevents duplicate submissions while the request is pending", async () => {
  let finish!: () => void;
  const onRevoke = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(<RevokeKey fingerprint="test…123" onRevoke={onRevoke} />);
  fireEvent.click(screen.getByRole("button", { name: "Revoke key test…123" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm revocation" }));
  fireEvent.click(screen.getByRole("button", { name: "Revoking…" }));
  expect(onRevoke).toHaveBeenCalledTimes(1);
  expect(
    (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  finish();
  await waitFor(() => expect(screen.queryByText("Revoking…")).toBeNull());
});

it("shows server failure and permits retry without claiming success", async () => {
  const onRevoke = vi.fn().mockRejectedValue(new Error("Network unavailable"));
  render(<RevokeKey fingerprint="test…123" onRevoke={onRevoke} />);
  fireEvent.click(screen.getByRole("button", { name: "Revoke key test…123" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm revocation" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe("Network unavailable"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm revocation" }));
  await waitFor(() => expect(onRevoke).toHaveBeenCalledTimes(2));
});
