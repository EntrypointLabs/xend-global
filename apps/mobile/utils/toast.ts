import type { ReactNode } from "react";

export type ToastOptions = {
  /**
   * A toast shown with the id of the one on screen replaces it in place rather
   * than sliding a new pill in, so progress reads as one toast changing state.
   */
  id?: string;
  durationMs?: number;
  tone?: ToastTone;
};

export type ToastTone = "default" | "success" | "failed";

type ToastHandler = (
  label: string,
  icon?: ReactNode,
  options?: ToastOptions
) => void;

let handler: ToastHandler | null = null;

export const setToastHandler = (fn: ToastHandler | null) => {
  handler = fn;
};

export const showToast = (
  label: string,
  icon?: ReactNode,
  options?: ToastOptions
) => {
  handler?.(label, icon, options);
};
