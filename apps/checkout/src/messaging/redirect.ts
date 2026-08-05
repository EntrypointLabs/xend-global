function isAbsoluteHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Redirect-completion. Navigates the current tab to the backend-signed return
 * URL (or signed cancel URL) with the status already appended by Phase 6. This
 * surface only navigates; it never signs or mints the URL. Rejects any URL that
 * is not absolute https.
 */
export function completeByRedirect(url: string): void {
  if (!isAbsoluteHttps(url)) {
    throw new Error('Refusing to redirect to a non-https-absolute URL');
  }
  window.location.assign(url);
}
