// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OverviewDashboard } from "./OverviewDashboard";

afterEach(cleanup);

const defaults = {
  activeKeys: 1,
  cluster: "devnet",
  name: "Chowderr",
  onPayments: vi.fn(),
  onAccount: vi.fn(),
};

describe("Merchant overview", () => {
  it("counts only successful on-chain Payments as received", () => {
    render(
      <OverviewDashboard
        {...defaults}
        payments={[
          {
            id: "latest",
            status: "succeeded",
            amountRaw: "751544",
            mode: "devnet",
          },
          {
            id: "earliest",
            status: "succeeded",
            amountRaw: "1000000",
            mode: "devnet",
          },
          {
            id: "simulation",
            status: "succeeded",
            amountRaw: "9000000",
            mode: "test",
          },
          {
            id: "failed",
            status: "failed",
            amountRaw: "8000000",
            mode: "devnet",
          },
          {
            id: "unpaid",
            status: "settling",
            amountRaw: "7000000",
            mode: "devnet",
          },
        ]}
      />,
    );
    expect(screen.getByText("1.751544")).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "2 confirmed Payments, 1.751544 USDC total. Values plotted from oldest to newest.",
    );
    expect(
      screen.getByText("Awaiting payment").closest("article")?.textContent,
    ).toContain("1");
    expect(screen.getByText("Simulation")).toBeTruthy();
  });

  it("does not fabricate a chart or earnings for an empty account", () => {
    render(<OverviewDashboard {...defaults} payments={[]} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("0.00")).toBeTruthy();
    expect(
      screen.getByText("Your first confirmed Payment will appear here."),
    ).toBeTruthy();
    expect(screen.getByText("No Payments yet.")).toBeTruthy();
  });

  it("keeps raw USDC precision above the safe integer limit", () => {
    render(
      <OverviewDashboard
        {...defaults}
        payments={[
          {
            id: "large",
            status: "succeeded",
            amountRaw: "9007199254740993",
            mode: "live",
          },
          { id: "small", status: "succeeded", amountRaw: "1", mode: "live" },
        ]}
      />,
    );
    expect(screen.getByText("9007199254.740994")).toBeTruthy();
  });

  it("opens the actual Payments and receiving-account pages", () => {
    const onPayments = vi.fn();
    const onAccount = vi.fn();
    render(
      <OverviewDashboard
        {...defaults}
        payments={[]}
        onPayments={onPayments}
        onAccount={onAccount}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "View all Payments" }));
    fireEvent.click(
      screen.getByRole("button", { name: "View receiving account" }),
    );
    expect(onPayments).toHaveBeenCalledOnce();
    expect(onAccount).toHaveBeenCalledOnce();
  });
});
