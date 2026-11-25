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

const handlers: ToastHandler[] = [];

/**
 * Registers a toast host and returns the call that removes it. Hosts stack:
 * a screen presented as a native modal mounts its own, since the app's host is
 * drawn underneath it, and the app's host takes over again when it leaves.
 */
export const addToastHandler = (fn: ToastHandler) => {
  handlers.push(fn);
  return () => {
    const index = handlers.lastIndexOf(fn);
    if (index !== -1) handlers.splice(index, 1);
  };
};

export const showToast = (
  label: string,
  icon?: ReactNode,
  options?: ToastOptions
) => {
  handlers[handlers.length - 1]?.(label, icon, options);
};
