// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MerchantSessionBoundary } from "./MerchantSessionBoundary";

afterEach(cleanup);

it("shows only the loading message, without login branding or a skeleton", () => {
  const { container } = render(
    <MerchantSessionBoundary ready={false} authenticated={false} accountLoading>
      <nav aria-label="Merchant workspace">Home</nav>
    </MerchantSessionBoundary>,
  );
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByRole("status").textContent).toBe(
    "Loading your dashboard...",
  );
  expect(
    screen.queryByRole("region", { name: "Pay with Xend for business" }),
  ).toBeNull();
  expect(screen.getByRole("main").getAttribute("aria-busy")).toBe("true");
  expect(container.querySelector(".merchant-entry")).toBeNull();
  expect(container.querySelector(".entry-story")).toBeNull();
  expect(container.querySelector(".workspace-skeleton")).toBeNull();
});

it("never flashes sign-in while restoring a returning session", () => {
  const { rerender } = render(
    <MerchantSessionBoundary ready={false} authenticated={false} accountLoading>
      <button>Sign in</button>
    </MerchantSessionBoundary>,
  );
  expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  expect(screen.getByRole("status")).toBeTruthy();
  rerender(
    <MerchantSessionBoundary ready authenticated accountLoading>
      <p>Account setup</p>
    </MerchantSessionBoundary>,
  );
  expect(screen.queryByText("Account setup")).toBeNull();
  rerender(
    <MerchantSessionBoundary ready authenticated accountLoading={false}>
      <h1>Dashboard</h1>
    </MerchantSessionBoundary>,
  );
  expect(screen.getByRole("heading", { name: "Dashboard" })).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
});

it("shows login once restoration confirms a signed-out session", () => {
  render(
    <MerchantSessionBoundary ready authenticated={false} accountLoading>
      <button>Sign in</button>
    </MerchantSessionBoundary>,
  );
  expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
});

it("does not hide a resolved account error or missing-account setup", () => {
  render(
    <MerchantSessionBoundary ready authenticated accountLoading={false}>
      <p role="alert">Try again</p>
    </MerchantSessionBoundary>,
  );
  expect(screen.getByRole("alert").textContent).toBe("Try again");
});
