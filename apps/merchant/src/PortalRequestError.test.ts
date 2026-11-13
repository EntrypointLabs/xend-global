import { expect, it } from "vitest";
import { PortalRequestError } from "./PortalRequestError";
it("preserves only well-formed validation details", () => {
  const error = new PortalRequestError({
    message: "Validation failed",
    details: [
      null,
      { path: "phone", message: "wrong shape" },
      { path: ["profile", "phone"], message: "Invalid phone" },
      { path: ["profile", "phone"], message: "Second error" },
      { path: ["displayName"], message: "Too short" },
    ],
  });
  expect(error.fieldErrors).toEqual({
    "profile.phone": "Invalid phone",
    displayName: "Too short",
  });
});
it("handles unavailable or non-JSON-shaped error data safely", () => {
  expect(new PortalRequestError(null).message).toBe(
    "We could not complete that request.",
  );
  expect(new PortalRequestError({ details: "bad" }).fieldErrors).toEqual({});
});
