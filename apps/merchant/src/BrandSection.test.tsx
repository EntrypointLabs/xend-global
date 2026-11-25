// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { BrandSection, type BrandMerchant } from "./BrandSection";
import { PortalRequestError } from "./PortalRequestError";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const merchant: BrandMerchant = {
  displayName: "Ada Stores",
  logoUrl: "https://api.prydd.co/v1/merchant-logos/m1?v=1",
  category: "food_drink",
  logoSource: "upload",
};

function setup(overrides: Partial<Parameters<typeof BrandSection>[0]> = {}) {
  const props = {
    merchant,
    onCategory: vi.fn().mockResolvedValue(undefined),
    onUpload: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    prepare: vi
      .fn()
      .mockResolvedValue({ contentType: "image/png", dataBase64: "AAAA" }),
    ...overrides,
  };
  const view = render(<BrandSection {...props} />);
  return { ...props, view };
}

function choose(file: File) {
  fireEvent.change(screen.getByLabelText("Logo file"), {
    target: { files: [file] },
  });
}

it("rejects an unsupported file type without uploading", async () => {
  const { onUpload, prepare } = setup();
  choose(new File(["gif"], "logo.gif", { type: "image/gif" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Use a PNG, JPG or WebP image.",
  );
  expect(prepare).not.toHaveBeenCalled();
  expect(onUpload).not.toHaveBeenCalled();
});

it("rejects an oversized original before decoding it", async () => {
  const { onUpload, prepare } = setup();
  const big = new File([new Uint8Array(9 * 1024 * 1024)], "logo.png", {
    type: "image/png",
  });
  choose(big);
  expect((await screen.findByRole("alert")).textContent).toMatch(/over 8 MB/);
  expect(prepare).not.toHaveBeenCalled();
  expect(onUpload).not.toHaveBeenCalled();
});

it("uploads the resized logo", async () => {
  const { onUpload, prepare } = setup();
  const file = new File(["png"], "logo.png", { type: "image/png" });
  choose(file);
  await waitFor(() =>
    expect(onUpload).toHaveBeenCalledWith({
      contentType: "image/png",
      dataBase64: "AAAA",
    }),
  );
  expect(prepare).toHaveBeenCalledWith(file);
  expect((await screen.findByRole("status")).textContent).toBe("Logo updated.");
});

it("explains a logo the server says is too large", async () => {
  setup({
    onUpload: vi
      .fn()
      .mockRejectedValue(
        new PortalRequestError(
          { code: "LOGO_TOO_LARGE", message: "Payload too large" },
          413,
        ),
      ),
  });
  choose(new File(["png"], "logo.png", { type: "image/png" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "That logo is over 256 KB. Choose a smaller image.",
  );
});

it("saves a new category as soon as it is picked", async () => {
  const { onCategory } = setup();
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "groceries" },
  });
  await waitFor(() => expect(onCategory).toHaveBeenCalledWith("groceries"));
  expect((await screen.findByRole("status")).textContent).toBe(
    "Category saved.",
  );
});

it("falls back to the category icon when the logo fails to load", () => {
  const { view } = setup();
  const avatars = () =>
    Array.from(view.container.querySelectorAll(".merchant-avatar"));
  expect(avatars().every((a) => a.getAttribute("data-kind") === "logo")).toBe(
    true,
  );
  for (const image of view.container.querySelectorAll("img"))
    fireEvent.error(image);
  expect(
    avatars().every((a) => a.getAttribute("data-kind") === "category"),
  ).toBe(true);
  expect(view.container.querySelectorAll(".merchant-avatar svg")).toHaveLength(
    2,
  );
});

it("only offers Remove for an uploaded logo", () => {
  setup({ merchant: { ...merchant, logoSource: "site" } });
  expect(screen.queryByText("Remove")).toBeNull();
  cleanup();
  const { onRemove } = setup();
  fireEvent.click(screen.getByText("Remove"));
  expect(onRemove).toHaveBeenCalled();
});
