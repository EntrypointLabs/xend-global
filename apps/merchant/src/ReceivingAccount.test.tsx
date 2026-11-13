// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ReceivingAccount, type Destination } from "./ReceivingAccount";
import type { PortalClient } from "./portal";

afterEach(cleanup);

const BANKS = { banks: [{ code: "058", name: "Guaranty Trust Bank" }] };
const CONFIRMED = {
  accountName: "ADA STORES LIMITED",
  bankName: "Guaranty Trust Bank",
  accountLast4: "6789",
};

function setup(
  opts: {
    destination?: Destination | null;
    nairaAvailable?: boolean;
    post?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const get = vi.fn().mockResolvedValue(BANKS);
  const post = opts.post ?? vi.fn().mockResolvedValue(CONFIRMED);
  const onConnected = vi.fn().mockResolvedValue(undefined);
  render(
    <ReceivingAccount
      client={{ get, post } as unknown as PortalClient}
      destination={opts.destination ?? null}
      receivingWallet="MerchantWallet111"
      cluster="devnet"
      nairaAvailable={opts.nairaAvailable ?? true}
      busy={false}
      run={(action) => action()}
      onConnected={onConnected}
    />,
  );
  return { get, post, onConnected };
}

async function enterAccount(accountNumber: string) {
  fireEvent.click(screen.getByLabelText("Naira to my bank"));
  await screen.findByRole("option", { name: "Guaranty Trust Bank" });
  fireEvent.change(screen.getByLabelText("Bank"), { target: { value: "058" } });
  fireEvent.change(screen.getByLabelText("Account number"), {
    target: { value: accountNumber },
  });
}

describe("ReceivingAccount", () => {
  it("offers only USDC while naira settlement is unavailable", () => {
    const { get } = setup({ nairaAvailable: false });

    expect(screen.queryByLabelText("Naira to my bank")).toBeNull();
    expect(screen.getByText("MerchantWallet111")).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });

  it("initializes a USDC account by default", async () => {
    const { post, onConnected } = setup();

    fireEvent.click(screen.getByText(/Initialize USDC account/));

    await waitFor(() => expect(onConnected).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith("destination");
  });

  it("shows the account holder before the bank account can be connected", async () => {
    const { post, onConnected } = setup();
    await enterAccount("0123456789");

    const connect = screen.getByRole("button", {
      name: "Connect bank account",
    }) as HTMLButtonElement;
    expect(connect.disabled).toBe(true);

    await screen.findByText("ADA STORES LIMITED");
    expect(post).toHaveBeenCalledWith("naira/account", {
      bankCode: "058",
      accountNumber: "0123456789",
    });
    fireEvent.click(connect);

    await waitFor(() => expect(onConnected).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith("naira/destination", {
      bankCode: "058",
      accountNumber: "0123456789",
      confirmedAccountName: "ADA STORES LIMITED",
    });
  });

  it("does not check an incomplete account number", async () => {
    const { post } = setup();
    await enterAccount("01234");

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(post).not.toHaveBeenCalled();
  });

  it("keeps connect disabled when the bank cannot confirm the account", async () => {
    setup({
      post: vi
        .fn()
        .mockRejectedValue(new Error("We could not confirm that account.")),
    });
    await enterAccount("0123456789");

    await screen.findByText("We could not confirm that account.");
    const connect = screen.getByRole("button", {
      name: "Connect bank account",
    }) as HTMLButtonElement;
    expect(connect.disabled).toBe(true);
  });

  it("shows a connected bank account without the full number", () => {
    setup({
      destination: { address: "TokenAccount", bankAccount: CONFIRMED },
    });

    expect(screen.getByText("ADA STORES LIMITED")).toBeTruthy();
    expect(screen.getByText("6789", { exact: false })).toBeTruthy();
    expect(screen.queryByText("TokenAccount")).toBeNull();
    expect(screen.queryByLabelText("Naira to my bank")).toBeNull();
  });

  it("shows a connected USDC account with no currency choice", () => {
    setup({ destination: { address: "UsdcTokenAccount" } });

    expect(screen.getByText("UsdcTokenAccount")).toBeTruthy();
    expect(screen.queryByLabelText("Naira to my bank")).toBeNull();
    expect(screen.queryByText(/Initialize USDC account/)).toBeNull();
  });
});
