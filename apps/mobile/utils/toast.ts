import type { ReactNode } from "react";

type ToastHandler = (label: string, icon?: ReactNode) => void;

let handler: ToastHandler | null = null;

export const setToastHandler = (fn: ToastHandler | null) => {
  handler = fn;
};

export const showToast = (label: string, icon?: ReactNode) => {
  handler?.(label, icon);
};
