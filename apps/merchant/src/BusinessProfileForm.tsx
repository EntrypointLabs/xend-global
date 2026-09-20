import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { PortalRequestError } from "./PortalRequestError";

const fields = [
  ["legalName", "Legal business name", "text", 200],
  ["contactName", "Contact name", "text", 100],
  ["contactEmail", "Business contact email", "email", 254],
  ["phone", "Phone number", "tel", 40],
  ["website", "Business website", "url", 2048],
  ["addressLine1", "Address line 1", "text", 200],
  ["addressLine2", "Address line 2", "text", 200],
  ["city", "City", "text", 100],
  ["region", "State / region", "text", 100],
  ["postalCode", "Postal code", "text", 30],
  ["country", "Country", "text", 100],
] as const;

export type BusinessProfile = Record<(typeof fields)[number][0], string>;
export type ProfileUpdate = {
  displayName: string;
  expectedVersion: number;
  profile: BusinessProfile;
};
export type ProfileMerchant = {
  id: string;
  displayName: string;
  signInEmail: string | null;
  profileVersion: number;
  businessProfile: Partial<BusinessProfile>;
  kybStatus: string;
};
export type BusinessProfileHandle = { canLeave: () => boolean };

export function BusinessProfileForm({
  merchant,
  onSave,
  ref,
}: {
  merchant: ProfileMerchant;
  onSave: (update: ProfileUpdate) => Promise<ProfileMerchant>;
  ref?: Ref<BusinessProfileHandle>;
}) {
  const [baseline, setBaseline] = useState(merchant);
  const [displayName, setDisplayName] = useState(merchant.displayName);
  const [profile, setProfile] = useState(
    () =>
      Object.fromEntries(
        fields.map(([key]) => [key, merchant.businessProfile?.[key] ?? ""]),
      ) as BusinessProfile,
  );
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formId = useId();
  const submitting = useRef(false);
  const dirty =
    displayName !== baseline.displayName ||
    fields.some(
      ([key]) => profile[key] !== (baseline.businessProfile?.[key] ?? ""),
    );
  useImperativeHandle(
    ref,
    () => ({
      canLeave: () =>
        !busy &&
        (!dirty || window.confirm("Discard unsaved business details?")),
    }),
    [busy, dirty],
  );
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  useEffect(() => {
    if (merchant.profileVersion === baseline.profileVersion) return;
    setBaseline(merchant);
    setDisplayName(merchant.displayName);
    setProfile(
      Object.fromEntries(
        fields.map(([key]) => [key, merchant.businessProfile?.[key] ?? ""]),
      ) as BusinessProfile,
    );
    setError("");
    setFieldErrors({});
    setEditing(false);
    setSaved(false);
  }, [merchant, baseline.profileVersion]);
  function reset(next: ProfileMerchant) {
    setDisplayName(next.displayName);
    setProfile(
      Object.fromEntries(
        fields.map(([key]) => [key, next.businessProfile?.[key] ?? ""]),
      ) as BusinessProfile,
    );
    setError("");
    setFieldErrors({});
    setEditing(false);
  }
  return (
    <section className="panel business-profile">
      <div className="section-head">
        <div>
          <h2>Business details</h2>
          <p>Manage how your business appears and how to reach you.</p>
        </div>
        {!editing && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setEditing(true);
              setSaved(false);
            }}
          >
            Edit business details
          </button>
        )}
      </div>
      <label>
        Sign-in email
        <input
          value={merchant.signInEmail ?? "No email linked"}
          readOnly
          type="text"
        />
        <small>
          From your verified sign-in identity. Editing business contact details
          does not change your sign-in.
        </small>
      </label>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!editing || submitting.current) return;
          submitting.current = true;
          setBusy(true);
          setError("");
          setFieldErrors({});
          setSaved(false);
          try {
            const next = await onSave({
              displayName,
              profile,
              expectedVersion: baseline.profileVersion,
            });
            setBaseline(next);
            reset(next);
            setSaved(true);
          } catch (failure) {
            if (failure instanceof PortalRequestError)
              setFieldErrors(failure.fieldErrors);
            setError(
              failure instanceof Error
                ? failure.message
                : "Your changes could not be saved. Please try again.",
            );
          } finally {
            submitting.current = false;
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <div className="profile-fields">
            <label>
              Business display name
              <input
                required
                minLength={2}
                maxLength={100}
                value={displayName}
                readOnly={!editing}
                aria-invalid={Boolean(fieldErrors.displayName)}
                aria-describedby={
                  fieldErrors.displayName ? `${formId}-displayName` : undefined
                }
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setFieldErrors((previous) => ({
                    ...previous,
                    displayName: "",
                  }));
                }}
              />
              {fieldErrors.displayName && (
                <small id={`${formId}-displayName`} className="field-error">
                  {fieldErrors.displayName}
                </small>
              )}
            </label>
            {fields.map(([key, label, type, max]) => (
              <label key={key}>
                {label}
                <input
                  type={type}
                  maxLength={max}
                  value={profile[key]}
                  aria-invalid={Boolean(fieldErrors[`profile.${key}`])}
                  aria-describedby={
                    fieldErrors[`profile.${key}`]
                      ? `${formId}-${key}`
                      : undefined
                  }
                  readOnly={
                    !editing ||
                    (key === "legalName" && merchant.kybStatus === "verified")
                  }
                  onChange={(e) => {
                    setProfile({ ...profile, [key]: e.target.value });
                    setFieldErrors((previous) => ({
                      ...previous,
                      [`profile.${key}`]: "",
                    }));
                  }}
                  placeholder={
                    editing && key === "website"
                      ? "https://your-business.com"
                      : undefined
                  }
                />
                {fieldErrors[`profile.${key}`] && (
                  <small id={`${formId}-${key}`} className="field-error">
                    {fieldErrors[`profile.${key}`]}
                  </small>
                )}
                {key === "legalName" && merchant.kybStatus === "verified" && (
                  <small>Changes require verification review.</small>
                )}
                {key === "contactEmail" && (
                  <small>
                    Contact information only; not a verified sign-in or recovery
                    address.
                  </small>
                )}
              </label>
            ))}
          </div>
          {editing && (
            <div className="actions">
              <button type="submit">{busy ? "Saving…" : "Save changes"}</button>
              <button
                type="button"
                className="secondary"
                onClick={() => reset(baseline)}
              >
                Cancel
              </button>
            </div>
          )}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        {saved && <p role="status">Business details saved.</p>}
      </form>
    </section>
  );
}
