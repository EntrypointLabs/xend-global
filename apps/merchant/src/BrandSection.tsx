import { useId, useRef, useState } from "react";
import { PortalRequestError } from "./PortalRequestError";
import {
  CategoryIcon,
  MERCHANT_CATEGORIES,
  isMerchantCategory,
  type MerchantCategory,
} from "./merchantCategory";

export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoType = (typeof LOGO_TYPES)[number];
export type LogoUpload = { contentType: LogoType; dataBase64: string };

export const LOGO_MAX_BYTES = 256 * 1024;
const LOGO_EDGE = 256;
const LOGO_MIN_EDGE = 128;
// Originals are resized before upload, so this only guards against decoding
// something enormous in the browser.
const SOURCE_MAX_BYTES = 8 * 1024 * 1024;

export type BrandMerchant = {
  displayName: string;
  logoUrl: string | null;
  category: MerchantCategory;
  /** Set when the backend says where the logo came from. */
  logoSource?: "upload" | "site" | null;
};

export class LogoRejected extends Error {}

export function checkLogoFile(file: File): string | null {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type))
    return "Use a PNG, JPG or WebP image.";
  if (file.size > SOURCE_MAX_BYTES)
    return "That image is over 8 MB. Choose a smaller file.";
  return null;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () =>
      reject(new LogoRejected("We couldn’t read that image."));
    reader.readAsDataURL(blob);
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new LogoRejected("We couldn’t read that image. Try another file."),
      );
    };
    image.src = url;
  });
}

/** Center-crops to a square and scales down to at most 256 × 256. */
export async function prepareLogo(file: File): Promise<LogoUpload> {
  const image = await loadImage(file);
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  if (side < LOGO_MIN_EDGE)
    throw new LogoRejected(
      `Use an image at least ${LOGO_MIN_EDGE} × ${LOGO_MIN_EDGE} pixels.`,
    );
  const edge = Math.min(side, LOGO_EDGE);
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext("2d");
  if (!context)
    throw new LogoRejected("Your browser couldn’t resize that image.");
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    (image.naturalWidth - side) / 2,
    (image.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    edge,
    edge,
  );
  // JPEG has no transparency, so only photos stay JPEG.
  const contentType: LogoType =
    file.type === "image/jpeg" ? "image/jpeg" : "image/png";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, contentType, 0.9),
  );
  if (!blob) throw new LogoRejected("Your browser couldn’t resize that image.");
  if (blob.size > LOGO_MAX_BYTES)
    throw new LogoRejected(
      "That logo is still over 256 KB after resizing. Try a simpler image.",
    );
  return { contentType, dataBase64: await blobToBase64(blob) };
}

function uploadMessage(failure: unknown): string {
  if (failure instanceof PortalRequestError) {
    if (failure.code === "LOGO_TOO_LARGE" || failure.status === 413)
      return "That logo is over 256 KB. Choose a smaller image.";
    if (failure.code === "LOGO_TYPE_UNSUPPORTED" || failure.status === 415)
      return "Use a PNG, JPG or WebP image.";
  }
  return failure instanceof Error && failure.message
    ? failure.message
    : "We couldn’t update your logo. Try again.";
}

export function MerchantAvatar({
  logoUrl,
  category,
  size,
  onLoad,
}: {
  logoUrl: string | null;
  category: MerchantCategory;
  size: number;
  onLoad?: (url: string) => void;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showLogo = logoUrl !== null && failedUrl !== logoUrl;
  return (
    <span
      className="merchant-avatar"
      data-kind={showLogo ? "logo" : "category"}
      style={{ width: size, height: size }}
    >
      {showLogo ? (
        <img
          src={logoUrl}
          alt=""
          width={size}
          height={size}
          onLoad={() => onLoad?.(logoUrl)}
          onError={() => setFailedUrl(logoUrl)}
        />
      ) : (
        <CategoryIcon category={category} size={Math.round(size * 0.46)} />
      )}
    </span>
  );
}

export function BrandSection({
  merchant,
  onCategory,
  onUpload,
  onRemove,
  prepare = prepareLogo,
}: {
  merchant: BrandMerchant;
  onCategory: (category: MerchantCategory) => Promise<void>;
  onUpload: (logo: LogoUpload) => Promise<void>;
  onRemove: () => Promise<void>;
  prepare?: (file: File) => Promise<LogoUpload>;
}) {
  const [busy, setBusy] = useState<"logo" | "category" | null>(null);
  const [logoError, setLogoError] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [status, setStatus] = useState("");
  const [pendingCategory, setPendingCategory] =
    useState<MerchantCategory | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const category = pendingCategory ?? merchant.category;
  const canRemove =
    merchant.logoSource === undefined
      ? merchant.logoUrl !== null && loadedUrl === merchant.logoUrl
      : merchant.logoSource === "upload";

  async function upload(file: File) {
    setLogoError("");
    setStatus("");
    const invalid = checkLogoFile(file);
    if (invalid) {
      setLogoError(invalid);
      return;
    }
    setBusy("logo");
    try {
      await onUpload(await prepare(file));
      setStatus("Logo updated.");
    } catch (failure) {
      setLogoError(uploadMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setLogoError("");
    setStatus("");
    setBusy("logo");
    try {
      await onRemove();
      setStatus("Logo removed.");
    } catch (failure) {
      setLogoError(uploadMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  async function changeCategory(next: MerchantCategory) {
    setCategoryError("");
    setStatus("");
    setPendingCategory(next);
    setBusy("category");
    try {
      await onCategory(next);
      setStatus("Category saved.");
    } catch (failure) {
      setCategoryError(
        failure instanceof Error && failure.message
          ? failure.message
          : "We couldn’t save your category. Try again.",
      );
    } finally {
      setPendingCategory(null);
      setBusy(null);
    }
  }

  return (
    <section className="settings-section brand-card">
      <header>
        <h2>Brand</h2>
        <p>How shoppers recognise you in the Prydd app.</p>
      </header>
      <div className="settings-body">
        <div className="brand-logo">
          <span className="brand-logo-tile">
            <MerchantAvatar
              logoUrl={merchant.logoUrl}
              category={category}
              size={72}
              onLoad={setLoadedUrl}
            />
          </span>
          <div className="brand-logo-copy">
            <strong>Logo</strong>
            <small id={`${id}-logo-hint`}>
              PNG, JPG or WebP. Square works best, at least 128 × 128. We resize
              it to 256 × 256.
            </small>
            <div className="actions">
              <button
                type="button"
                className="secondary small"
                disabled={busy !== null}
                aria-describedby={`${id}-logo-hint`}
                onClick={() => fileInput.current?.click()}
              >
                {busy === "logo" ? "Saving…" : "Upload logo"}
              </button>
              {canRemove && (
                <button
                  type="button"
                  className="quiet small"
                  disabled={busy !== null}
                  onClick={() => void remove()}
                >
                  Remove
                </button>
              )}
              <input
                ref={fileInput}
                className="visually-hidden"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="Logo file"
                tabIndex={-1}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void upload(file);
                }}
              />
            </div>
          </div>
        </div>
        {logoError && (
          <p className="inline-error" role="alert">
            {logoError}
          </p>
        )}
        <label className="brand-category">
          Category
          <select
            value={category}
            disabled={busy !== null}
            aria-invalid={Boolean(categoryError)}
            onChange={(event) => {
              if (isMerchantCategory(event.target.value))
                void changeCategory(event.target.value);
            }}
          >
            {MERCHANT_CATEGORIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {categoryError ? (
            <small className="field-error" role="alert">
              {categoryError}
            </small>
          ) : (
            <small>Its icon stands in for your logo when you have none.</small>
          )}
        </label>
        <div className="shopper-preview">
          <span className="shopper-preview-label">How shoppers see you</span>
          <div className="activity-row" aria-label="Activity preview">
            <MerchantAvatar
              logoUrl={merchant.logoUrl}
              category={category}
              size={40}
            />
            <span className="activity-row-text">
              <strong>{merchant.displayName}</strong>
              <span>Paid · Just now</span>
            </span>
            <span className="activity-row-amount num">−$8.00</span>
          </div>
        </div>
        {status && (
          <p className="brand-status" role="status">
            {status}
          </p>
        )}
      </div>
    </section>
  );
}
