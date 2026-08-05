import type { CheckoutStatus } from "./types";

/** Fields the modal renders. Sourced from the checkout summary; never the amount that settles. */
export interface CheckoutSummary {
  merchantDisplayName: string;
  ngnDisplayMinor: string | null;
  itemLabel?: string | null;
}

export type ModalTheme = "auto" | "light" | "dark";

export interface ModalHandle {
  showLoading: () => void;
  showConfirm: (summary: CheckoutSummary) => void;
  showAuthorizing: () => void;
  showResult: (status: CheckoutStatus) => void;
  showError: (message: string) => void;
  close: () => void;
}

interface ModalOptions {
  doc: Document;
  theme: ModalTheme;
  onConfirm: () => void;
  onCancel: () => void;
}

const CSS = `
:host, * { box-sizing: border-box; }
.wrap { position: fixed; inset: 0; z-index: 2147483000; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.scrim { position: absolute; inset: 0; background: rgba(0,0,0,.28); backdrop-filter: blur(2px); opacity: 0; transition: opacity .3s ease; }
.wrap.open .scrim { opacity: 1; }
.stage { position: absolute; inset: 0; display: grid; }
[data-theme="light"] {
  --mat: rgba(250,250,252,0.62); --edge: rgba(255,255,255,0.55); --text:#111114; --muted:#66666e; --muted2:#8a8a92;
  --field: rgba(120,120,128,0.12); --fedge: rgba(120,120,128,0.14); --primary:#0a0a0a; --pink:#fff; --chip: rgba(120,120,128,0.16); --chipink:#3a3a40; --glyph:#111114;
}
[data-theme="dark"] {
  --mat: rgba(30,30,34,0.55); --edge: rgba(255,255,255,0.14); --text:#f5f5f7; --muted:#9a9aa2; --muted2:#78787f;
  --field: rgba(255,255,255,0.08); --fedge: rgba(255,255,255,0.08); --primary:#f5f5f7; --pink:#0a0a0a; --chip: rgba(255,255,255,0.14); --chipink:#d8d8de; --glyph:#f5f5f7;
}
.sheet { position: relative; color: var(--text); background: var(--mat); border: 1px solid var(--edge); box-shadow: 0 40px 120px -24px rgba(0,0,0,.55); overflow: hidden; will-change: transform, opacity;
  backdrop-filter: blur(44px) saturate(180%); -webkit-backdrop-filter: blur(44px) saturate(180%); }
.sheet::before { content:""; position:absolute; inset:0 0 auto 0; height:1px; background: linear-gradient(90deg, transparent, rgba(255,255,255,.55), transparent); opacity:.7; }
/* desktop: centered modal */
.wrap.modal .stage { place-items: center; }
.wrap.modal .sheet { width: 390px; max-width: calc(100vw - 32px); border-radius: 28px; padding: 24px 24px 20px; transform: translateY(12px) scale(.955); opacity: 0; transition: transform .36s cubic-bezier(.2,.9,.25,1.04), opacity .26s ease; }
.wrap.modal.open .sheet { transform: none; opacity: 1; }
.wrap.modal .grabber { display: none; }
/* mobile: bottom sheet */
.wrap.sheetmode .stage { align-items: end; }
.wrap.sheetmode .sheet { width: 100%; border-radius: 30px 30px 0 0; padding: 10px 22px calc(24px + env(safe-area-inset-bottom)); transform: translateY(100%); transition: transform .42s cubic-bezier(.22,.9,.24,1); }
.wrap.sheetmode.open .sheet { transform: none; }
.grabber { width: 38px; height: 5px; border-radius: 3px; background: var(--muted2); opacity: .5; margin: 0 auto 16px; }
.head { display: flex; align-items: center; gap: 11px; margin-bottom: 20px; }
.mfav { width: 36px; height: 36px; border-radius: 11px; background: linear-gradient(150deg,#7c5cff,#14b8c9); flex: 0 0 auto; }
.mname { font-size: 15px; font-weight: 600; }
.msub { font-size: 12px; color: var(--muted); margin-top: 1px; }
.x { margin-left: auto; width: 30px; height: 30px; border-radius: 50%; border: 0; background: var(--chip); color: var(--chipink); cursor: pointer; font-size: 14px; }
.amt { text-align: center; padding: 4px 0 20px; }
.amt .k { font-size: 12.5px; color: var(--muted); }
.amt .v { font-family: -apple-system, "SF Pro Display", system-ui, sans-serif; font-size: 46px; font-weight: 700; letter-spacing: -.03em; margin-top: 5px; font-variant-numeric: tabular-nums; }
.amt .s { font-size: 12.5px; color: var(--muted2); margin-top: 6px; }
.src { display: flex; align-items: center; gap: 12px; background: var(--field); border: 1px solid var(--fedge); border-radius: 15px; padding: 13px 15px; margin-bottom: 16px; }
.src .dot { width: 32px; height: 32px; border-radius: 9px; background: color-mix(in srgb, var(--glyph) 12%, transparent); display: grid; place-items: center; flex: 0 0 auto; }
.src .t1 { font-size: 14px; font-weight: 600; }
.src .t2 { font-size: 12px; color: var(--muted); margin-top: 1px; }
.cta { width: 100%; height: 54px; border: 0; border-radius: 15px; cursor: pointer; background: var(--primary); color: var(--pink); font: 600 16px -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; gap: 9px; }
.cta:disabled { opacity: .4; cursor: default; }
.cta:not(:disabled):active { transform: scale(.985); }
.cancel { display: block; width: 100%; text-align: center; background: none; border: 0; color: var(--muted); font-size: 14px; padding: 15px 0 4px; cursor: pointer; }
.foot { display: flex; align-items: center; justify-content: center; gap: 6px; color: var(--muted2); font-size: 11.5px; margin-top: 12px; }
.center { text-align: center; padding: 18px 0 8px; }
.facebig { width: 76px; height: 76px; margin: 8px auto 18px; border-radius: 20px; background: color-mix(in srgb, var(--glyph) 8%, transparent); display: grid; place-items: center; }
.facebig.scan { animation: scan 1.2s ease-in-out infinite; }
@keyframes scan { 0%,100% { transform: scale(1); opacity:.9; } 50% { transform: scale(1.04); opacity:1; } }
.check { width: 78px; height: 78px; margin: 0 auto 16px; border-radius: 50%; display: grid; place-items: center; border: 2px solid #30d158; }
.title { font-size: 18px; font-weight: 700; }
.sub { font-size: 13px; color: var(--muted); margin-top: 6px; }
.spinner { width: 34px; height: 34px; margin: 20px auto; border-radius: 50%; border: 3px solid var(--field); border-top-color: var(--muted); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
`;

const FACE_ID = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--pink)" stroke-width="1.7" stroke-linecap="round" style="flex:0 0 auto"><path d="M4 8V6.5A2.5 2.5 0 016.5 4H8"/><path d="M16 4h1.5A2.5 2.5 0 0120 6.5V8"/><path d="M20 16v1.5a2.5 2.5 0 01-2.5 2.5H16"/><path d="M8 20H6.5A2.5 2.5 0 014 17.5V16"/><path d="M9 10v1M15 10v1M12 9v4l-1 1M9.5 15.5a3.5 3.5 0 005 0"/></svg>`;

function formatNaira(minor: string | null): string {
  if (!minor) return "";
  const n = Number(minor) / 100;
  return "₦" + n.toLocaleString("en-NG", { maximumFractionDigits: 0 });
}

function resolveTheme(theme: ModalTheme, doc: Document): "light" | "dark" {
  if (theme === "light" || theme === "dark") return theme;
  const win = doc.defaultView;
  return win?.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Open the in-page glass overlay. Rendered into a Shadow DOM host on the
 * merchant page so the frosted material can blur the merchant page behind it
 * (a cross-origin iframe cannot) while merchant CSS cannot reach the sheet.
 */
export function openModal(opts: ModalOptions): ModalHandle {
  const { doc, theme, onConfirm, onCancel } = opts;
  const host = doc.createElement("div");
  host.setAttribute("data-xend-checkout", "");
  const root = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = CSS;
  root.appendChild(style);

  const wrap = doc.createElement("div");
  wrap.className = "wrap";
  const win = doc.defaultView;
  const isMobile = (win?.innerWidth ?? 800) <= 640;
  wrap.classList.add(isMobile ? "sheetmode" : "modal");
  wrap.innerHTML = `<div class="scrim" data-close></div><div class="stage"><section class="sheet" role="dialog" aria-modal="true" data-theme="${resolveTheme(theme, doc)}"><div class="grabber"></div><div class="body"></div></section></div>`;
  root.appendChild(wrap);
  doc.body.appendChild(host);

  const body = wrap.querySelector(".body") as HTMLElement;
  requestAnimationFrame(() => wrap.classList.add("open"));

  const close = () => {
    wrap.classList.remove("open");
    win?.setTimeout(() => host.remove(), 420);
  };
  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.hasAttribute("data-close")) onCancel();
  });

  const render = (html: string) => {
    body.innerHTML = html;
  };

  return {
    showLoading() {
      render(
        `<div class="center"><div class="spinner"></div><div class="sub">Getting your payment ready…</div></div>`,
      );
    },
    showConfirm(summary) {
      render(`
        <div class="head"><span class="mfav"></span><div><div class="mname">${summary.merchantDisplayName}</div><div class="msub">Pay with Xend</div></div><button class="x" data-cancel aria-label="Close">✕</button></div>
        <div class="amt"><div class="k">You're paying</div><div class="v">${formatNaira(summary.ngnDisplayMinor)}</div>${summary.itemLabel ? `<div class="s">${summary.itemLabel}</div>` : ""}</div>
        <div class="src"><span class="dot"><svg width="17" height="17" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="13" rx="2.5" stroke="var(--glyph)" stroke-width="1.7"/><path d="M3 10h18" stroke="var(--glyph)" stroke-width="1.7"/></svg></span><div><div class="t1">Xend Cash</div><div class="t2">Pay with your Xend balance</div></div></div>
        <button class="cta" data-confirm disabled>${FACE_ID}Confirm with Face ID</button>
        <button class="cancel" data-cancel>Cancel</button>
        <div class="foot"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="9" rx="2" stroke="var(--muted2)" stroke-width="1.7"/><path d="M8 11V8a4 4 0 018 0v3" stroke="var(--muted2)" stroke-width="1.7"/></svg>Payments secured by Xend</div>`);
      const cta = body.querySelector("[data-confirm]") as HTMLButtonElement;
      body
        .querySelectorAll("[data-cancel]")
        .forEach((el) => el.addEventListener("click", onCancel));
      cta.addEventListener("click", onConfirm);
      // anti-clickjacking arm: enable only after a delay AND a real interaction
      let delayed = false,
        interacted = false;
      const arm = () => {
        if (delayed && interacted) cta.disabled = false;
      };
      win?.setTimeout(() => {
        delayed = true;
        arm();
      }, 500);
      const onInteract = () => {
        interacted = true;
        arm();
      };
      ["pointermove", "keydown", "wheel", "touchstart"].forEach((e) =>
        root.addEventListener(e, onInteract, { once: true }),
      );
    },
    showAuthorizing() {
      render(
        `<div class="center"><div class="facebig scan"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--glyph)" stroke-width="1.5" stroke-linecap="round"><path d="M4 8V6.5A2.5 2.5 0 016.5 4H8"/><path d="M16 4h1.5A2.5 2.5 0 0120 6.5V8"/><path d="M20 16v1.5a2.5 2.5 0 01-2.5 2.5H16"/><path d="M8 20H6.5A2.5 2.5 0 014 17.5V16"/><path d="M9 10v1.5M15 10v1.5M12 9v4l-1.2 1M9 15a4 4 0 006 0"/></svg></div><div class="title">Confirming with Face ID</div></div>`,
      );
    },
    showResult(status) {
      if (status === "succeeded") {
        render(
          `<div class="center"><div class="check"><svg width="38" height="38" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.2 4.2L19 7" stroke="#30d158" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="title">Done</div><div class="sub">Your receipt is on its way</div></div>`,
        );
      } else {
        const label =
          status === "expired"
            ? "This payment link expired"
            : status === "canceled"
              ? "Payment canceled"
              : "Payment couldn't be completed";
        render(
          `<div class="center"><div class="title">${label}</div><div class="sub">Head back to the store to try again.</div><button class="cancel" data-cancel style="margin-top:14px">Close</button></div>`,
        );
        body
          .querySelectorAll("[data-cancel]")
          .forEach((el) => el.addEventListener("click", onCancel));
      }
    },
    showError(message) {
      render(
        `<div class="center"><div class="title">Something went wrong</div><div class="sub">${message}</div><button class="cancel" data-cancel style="margin-top:14px">Close</button></div>`,
      );
      body
        .querySelectorAll("[data-cancel]")
        .forEach((el) => el.addEventListener("click", onCancel));
    },
    close,
  };
}
