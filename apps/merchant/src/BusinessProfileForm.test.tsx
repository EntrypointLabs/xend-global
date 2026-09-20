// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createRef } from "react";
import { PortalRequestError } from "./PortalRequestError";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  BusinessProfileForm,
  type ProfileMerchant,
  type BusinessProfileHandle,
} from "./BusinessProfileForm";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("warns only for changed values and removes the warning after cancel", () => {
  const { unmount } = render(
    <BusinessProfileForm merchant={merchant} onSave={vi.fn()} />,
  );
  const leave = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(leave()).toBe(false);
  fireEvent.click(screen.getByText("Edit business details"));
  expect(leave()).toBe(false);
  fireEvent.change(screen.getByLabelText("Contact name"), {
    target: { value: "Draft" },
  });
  expect(leave()).toBe(true);
  fireEvent.click(screen.getByText("Cancel"));
  expect(leave()).toBe(false);
  fireEvent.click(screen.getByText("Edit business details"));
  fireEvent.change(screen.getByLabelText("Contact name"), {
    target: { value: "Draft" },
  });
  unmount();
  expect(leave()).toBe(false);
});

it("lets a Merchant keep unsaved details when signing out", () => {
  const ref = createRef<BusinessProfileHandle>();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(
    <BusinessProfileForm ref={ref} merchant={merchant} onSave={vi.fn()} />,
  );
  expect(ref.current?.canLeave()).toBe(true);
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Edit business details"));
  fireEvent.change(screen.getByLabelText("Contact name"), {
    target: { value: "Draft" },
  });
  expect(ref.current?.canLeave()).toBe(false);
  confirm.mockReturnValue(true);
  expect(ref.current?.canLeave()).toBe(true);
});

it("associates server validation errors with the input and clears them when corrected", async () => {
  const failure = new PortalRequestError({
    message: "Validation failed",
    details: [
      { path: ["profile", "phone"], message: "Enter a valid phone number" },
    ],
  });
  render(
    <BusinessProfileForm
      merchant={merchant}
      onSave={vi.fn().mockRejectedValue(failure)}
    />,
  );
  fireEvent.click(screen.getByText("Edit business details"));
  const phone = screen.getByLabelText("Phone number");
  fireEvent.change(phone, { target: { value: "not a number" } });
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(phone.getAttribute("aria-invalid")).toBe("true"));
  const description = phone.getAttribute("aria-describedby");
  expect(document.getElementById(description!)?.textContent).toBe(
    "Enter a valid phone number",
  );
  expect((phone as HTMLInputElement).value).toBe("not a number");
  fireEvent.change(phone, { target: { value: "+234123456789" } });
  expect(phone.getAttribute("aria-invalid")).toBe("false");
  expect(screen.queryByText("Enter a valid phone number")).toBeNull();
});
const merchant: ProfileMerchant = {
  id: "m1",
  displayName: "Chowderr",
  signInEmail: "owner@example.com",
  profileVersion: 2,
  businessProfile: {},
  kybStatus: "pending",
};

it("shows sign-in email without allowing profile edits to change it", () => {
  render(<BusinessProfileForm merchant={merchant} onSave={vi.fn()} />);
  expect(
    (
      screen.getByLabelText("Sign-in email", {
        exact: false,
      }) as HTMLInputElement
    ).readOnly,
  ).toBe(true);
  expect(screen.getByDisplayValue("owner@example.com")).toBeTruthy();
});
it("saves the edited contact details with the version and reports success after acknowledgement", async () => {
  const onSave = vi.fn().mockImplementation(async (update) => ({
    ...merchant,
    ...update,
    businessProfile: update.profile,
    profileVersion: 3,
  }));
  render(<BusinessProfileForm merchant={merchant} onSave={onSave} />);
  fireEvent.click(screen.getByText("Edit business details"));
  fireEvent.change(screen.getByLabelText("Contact name"), {
    target: { value: "Kenny" },
  });
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe(
      "Business details saved.",
    ),
  );
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedVersion: 2,
      profile: expect.objectContaining({ contactName: "Kenny" }),
    }),
  );
  expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("signInEmail");
});
it("retains unsaved input and shows the server error after a rejected save", async () => {
  render(
    <BusinessProfileForm
      merchant={merchant}
      onSave={vi.fn().mockRejectedValue(new Error("Stale profile"))}
    />,
  );
  fireEvent.click(screen.getByText("Edit business details"));
  fireEvent.change(screen.getByLabelText("Contact name"), {
    target: { value: "Kenny" },
  });
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe("Stale profile"),
  );
  expect(screen.getByDisplayValue("Kenny")).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.click(screen.getByText("Cancel"));
  expect(screen.queryByDisplayValue("Kenny")).toBeNull();
});

it("refreshes fields and the optimistic-lock version when newer Merchant data arrives", async () => {
  const onSave = vi.fn().mockImplementation(async (update) => ({
    ...merchant,
    ...update,
    businessProfile: update.profile,
    profileVersion: 4,
  }));
  const { rerender } = render(
    <BusinessProfileForm merchant={merchant} onSave={onSave} />,
  );

  rerender(
    <BusinessProfileForm
      merchant={{
        ...merchant,
        displayName: "Chowdeck Europe",
        profileVersion: 3,
        businessProfile: { contactName: "Ada" },
      }}
      onSave={onSave}
    />,
  );

  expect(await screen.findByDisplayValue("Chowdeck Europe")).toBeTruthy();
  expect(screen.getByDisplayValue("Ada")).toBeTruthy();
  fireEvent.click(screen.getByText("Edit business details"));
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave.mock.calls[0]?.[0]).toMatchObject({ expectedVersion: 3 });
});
