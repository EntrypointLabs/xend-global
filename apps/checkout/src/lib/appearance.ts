import { isFramed } from './frame';

/**
 * The merchant's SDK passes its resolved sheet theme so the embedded surface
 * matches the glass sheet around it; anything else follows the system.
 */
export function applyAppearance(search: string, root: HTMLElement): void {
  const requested = new URLSearchParams(search).get('theme');
  const theme =
    requested === 'light' || requested === 'dark'
      ? requested
      : window.matchMedia?.('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark';
  root.dataset.theme = theme;
  if (isFramed()) root.dataset.framed = '';
}

/** The sheet slides in once; later state changes swap its content in place. */
export function settleAfterEntrance(root: HTMLElement): void {
  window.setTimeout(() => {
    root.dataset.settled = '';
  }, 500);
}
