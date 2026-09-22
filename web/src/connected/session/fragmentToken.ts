// Reads the one-shot `#invoice_session=TOKEN` fragment and strips it from the
// URL immediately. The token is returned to the caller and MUST NOT be
// persisted (localStorage) or logged anywhere — it is a single-use credential.

const TOKEN_PATTERN = /^#invoice_session=([^&]+)/;

/**
 * Reads and consumes the one-shot session token from the URL fragment, if
 * present. Strips the fragment via `history.replaceState` before returning, so
 * the token never lingers in the visible URL (browser history, screenshots,
 * accidental copy/paste) for even one render.
 */
export function readInvoiceSessionToken(location: Location = window.location): string | null {
  const hash = location.hash || "";
  const match = TOKEN_PATTERN.exec(hash);
  if (!match) return null;

  const token = decodeURIComponent(match[1]);
  stripFragment(location);
  return token || null;
}

function stripFragment(location: Location): void {
  if (typeof window === "undefined" || typeof window.history === "undefined") return;
  const url = new URL(location.href);
  url.hash = "";
  window.history.replaceState(null, "", url.toString());
}
