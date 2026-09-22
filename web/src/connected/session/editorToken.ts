// Holds the short-lived editor session: in-memory first, mirrored to
// sessionStorage only (never localStorage, never a query string, never
// logged). sessionStorage lets a reload within the same tab restore connected
// mode without forcing a full re-exchange, while still being cleared
// automatically when the tab/browser closes.
//
// Only the minimal fields needed to resume are stored: the editor access
// token itself, its expiry, and the permissions granted at exchange time.
// Permissions are never re-derived or assumed on restore — exactly what was
// issued is what gets used (see useConnectedSession's restore path).

export interface StoredEditorSession {
  editorAccessToken: string;
  accessExpiresAt: string;
  permissions: { read: boolean; edit: boolean; finalize: boolean };
}

const SESSION_STORAGE_KEY = "invoice.connected.editorSession";

let inMemory: StoredEditorSession | null = null;

function isValidRecord(value: unknown): value is StoredEditorSession {
  const v = value as Partial<StoredEditorSession> | null;
  return Boolean(
    v &&
      typeof v.editorAccessToken === "string" &&
      v.editorAccessToken.length > 0 &&
      typeof v.accessExpiresAt === "string" &&
      v.permissions &&
      typeof v.permissions.read === "boolean" &&
      typeof v.permissions.edit === "boolean" &&
      typeof v.permissions.finalize === "boolean"
  );
}

export function isSessionExpired(session: Pick<StoredEditorSession, "accessExpiresAt">): boolean {
  const t = Date.parse(session.accessExpiresAt);
  return !Number.isFinite(t) || t <= Date.now();
}

export function setEditorSession(session: StoredEditorSession): void {
  inMemory = session;
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // sessionStorage unavailable (private mode, etc.) — in-memory copy still works for this tab's lifetime.
  }
}

/**
 * Returns whatever session record is stored, WITHOUT clearing it even if
 * expired — callers decide what "expired" means for their own flow (e.g. a
 * reload must still recognize an expired session as "was connected", not
 * silently fall back to standalone). Use `getEditorSession()` instead when you
 * just need a currently-valid token.
 */
export function peekStoredSession(): StoredEditorSession | null {
  if (inMemory) return inMemory;
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidRecord(parsed)) return null;
    inMemory = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export function hasStoredSession(): boolean {
  return peekStoredSession() !== null;
}

/** A currently-valid session, or null if none exists or it has expired (expired records are cleared). */
export function getEditorSession(): StoredEditorSession | null {
  const stored = peekStoredSession();
  if (!stored) return null;
  if (isSessionExpired(stored)) {
    clearEditorToken();
    return null;
  }
  return stored;
}

export function getEditorToken(): string | null {
  return getEditorSession()?.editorAccessToken ?? null;
}

export function clearEditorToken(): void {
  inMemory = null;
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}
