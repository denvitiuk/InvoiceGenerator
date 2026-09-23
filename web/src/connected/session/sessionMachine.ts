// Pure connected-session state machine: no fetch, no React, no I/O. Every
// transition is a small pure function that validates the current phase before
// moving on, so illegal sequences (e.g. rendering a PDF before a number was
// reserved, or reserving a number twice) throw instead of silently happening.
//
// This is deliberately not a single generic `dispatch(action)` reducer — each
// transition function documents exactly which phase(s) it's legal from, which
// is what the sequencing tests assert against directly.

export type ApiErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "invalid_contract";

export type SessionPhase =
  | "idle"
  | "exchanging"
  | "exchange_error"
  | "awaiting_reconnect"
  | "unsupported_browser"
  | "vault_unavailable"
  | "loaded_editing"
  | "locked_finalized"
  | "saving_vault"
  | "saving_document"
  | "conflict"
  | "offline"
  | "session_expired"
  | "reserving"
  | "reserve_failed"
  | "preview_settling"
  | "rendering_pdf"
  | "render_failed"
  | "uploading_pdf"
  | "upload_failed"
  | "finalizing"
  | "finalize_failed"
  | "done";

export interface EditorPermissions {
  read: boolean;
  edit: boolean;
  finalize: boolean;
}

export interface SessionContext {
  requiresReview: boolean;
  permissions: EditorPermissions;
  /** Set true the instant reserveNumber() returns 2xx; never reset afterwards. */
  numberReserved: boolean;
}

export interface SessionMachineState {
  phase: SessionPhase;
  context: SessionContext;
  errorKind?: ApiErrorKind;
  conflictTarget?: "vault" | "document";
}

export class InvalidTransitionError extends Error {
  constructor(from: SessionPhase, action: string) {
    super(`Cannot ${action} from phase "${from}"`);
    this.name = "InvalidTransitionError";
  }
}

function assertPhase(state: SessionMachineState, allowed: SessionPhase[], action: string): void {
  if (!allowed.includes(state.phase)) {
    throw new InvalidTransitionError(state.phase, action);
  }
}

export function initialSessionState(): SessionMachineState {
  return {
    phase: "idle",
    context: {
      requiresReview: false,
      permissions: { read: false, edit: false, finalize: false },
      numberReserved: false,
    },
  };
}

export function isReadOnly(state: SessionMachineState): boolean {
  return state.context.permissions.read && !state.context.permissions.edit;
}

// --- Exchange -----------------------------------------------------------

export function startExchange(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["idle", "awaiting_reconnect"], "startExchange");
  return { ...state, phase: "exchanging", errorKind: undefined };
}

export function exchangeSucceeded(
  state: SessionMachineState,
  permissions: EditorPermissions
): SessionMachineState {
  assertPhase(state, ["exchanging"], "exchangeSucceeded");
  return {
    ...state,
    phase: "loaded_editing",
    context: { ...state.context, permissions },
    errorKind: undefined,
  };
}

export function exchangeFailed(state: SessionMachineState, kind: ApiErrorKind): SessionMachineState {
  assertPhase(state, ["exchanging"], "exchangeFailed");
  return { ...state, phase: "exchange_error", errorKind: kind };
}

export function openReconnectScreen(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["exchange_error", "session_expired"], "openReconnectScreen");
  return { ...state, phase: "awaiting_reconnect" };
}

// --- Restoring a session that survived a page reload ---------------------

/**
 * A still-valid editor session was found in sessionStorage on mount — skips
 * the exchange step entirely (we already hold a valid editor token) and goes
 * straight to loading the work package/vault/document, exactly like a fresh
 * exchange's success would. Permissions come from whatever was stored at the
 * original exchange time, never assumed/defaulted.
 */
export function restoreSession(state: SessionMachineState, permissions: EditorPermissions): SessionMachineState {
  assertPhase(state, ["idle"], "restoreSession");
  return { ...state, phase: "loaded_editing", context: { ...state.context, permissions }, errorKind: undefined };
}

/**
 * A session record was found in sessionStorage on mount, but it had already
 * expired (checked locally, before any network call) — go straight to the
 * expired-session screen rather than either attempting a doomed request or
 * silently falling back to the standalone editor.
 */
export function sessionExpiredOnRestore(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["idle"], "sessionExpiredOnRestore");
  return { ...state, phase: "session_expired" };
}

/**
 * The initial work-package/vault/document load failed right after a
 * successful exchange or session restore (both leave the machine in
 * "loaded_editing" before the load even starts). A 401/403 means the editor
 * session itself is no longer valid; anything else surfaces as a generic load
 * error via the same reconnect path as an exchange failure.
 */
export function loadFailed(state: SessionMachineState, kind: ApiErrorKind): SessionMachineState {
  assertPhase(state, ["loaded_editing"], "loadFailed");
  if (kind === "unauthorized" || kind === "forbidden") {
    return { ...state, phase: "session_expired", errorKind: kind };
  }
  return { ...state, phase: "exchange_error", errorKind: kind };
}

// --- Environment / permission gates -------------------------------------

export function markUnsupportedBrowser(state: SessionMachineState): SessionMachineState {
  return { ...state, phase: "unsupported_browser" };
}

export function markVaultUnavailable(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["loaded_editing"], "markVaultUnavailable");
  return { ...state, phase: "vault_unavailable" };
}

export function setRequiresReview(state: SessionMachineState, requiresReview: boolean): SessionMachineState {
  return { ...state, context: { ...state.context, requiresReview } };
}

export function lockAsFinalized(state: SessionMachineState): SessionMachineState {
  return { ...state, phase: "locked_finalized" };
}

// --- Autosave (vault / document) ----------------------------------------

export function startSavingVault(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["loaded_editing"], "startSavingVault");
  return { ...state, phase: "saving_vault" };
}

export function startSavingDocument(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["loaded_editing"], "startSavingDocument");
  return { ...state, phase: "saving_document" };
}

export function saveSucceeded(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["saving_vault", "saving_document"], "saveSucceeded");
  return { ...state, phase: "loaded_editing" };
}

export function saveConflict(state: SessionMachineState, target: "vault" | "document"): SessionMachineState {
  assertPhase(state, ["saving_vault", "saving_document"], "saveConflict");
  return { ...state, phase: "conflict", conflictTarget: target };
}

export function saveWentOffline(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["saving_vault", "saving_document"], "saveWentOffline");
  return { ...state, phase: "offline" };
}

export function saveSessionExpired(state: SessionMachineState): SessionMachineState {
  assertPhase(
    state,
    ["saving_vault", "saving_document", "reserving", "rendering_pdf", "uploading_pdf", "finalizing"],
    "saveSessionExpired"
  );
  return { ...state, phase: "session_expired" };
}

export function resumeEditing(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["conflict", "offline"], "resumeEditing");
  return { ...state, phase: "loaded_editing", conflictTarget: undefined };
}

/**
 * A save attempt failed for a reason that isn't a conflict/offline/expiry
 * (e.g. a one-off 5xx). Editing continues immediately; the caller surfaces
 * this via its own transient `saveState: "error"` UI flag rather than a
 * blocking session phase.
 */
export function saveGenericError(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["saving_vault", "saving_document"], "saveGenericError");
  return { ...state, phase: "loaded_editing" };
}

// --- Finalize sequencing: reserve -> preview -> render -> upload -> finalize

export function canStartReserve(state: SessionMachineState): boolean {
  return (
    state.phase === "loaded_editing" &&
    !state.context.requiresReview &&
    state.context.permissions.finalize &&
    !state.context.numberReserved
  );
}

export function startReserve(state: SessionMachineState): SessionMachineState {
  if (!canStartReserve(state)) {
    throw new InvalidTransitionError(state.phase, "startReserve");
  }
  return { ...state, phase: "reserving" };
}

export function reserveSucceeded(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["reserving"], "reserveSucceeded");
  return { ...state, phase: "preview_settling", context: { ...state.context, numberReserved: true } };
}

export function reserveFailed(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["reserving"], "reserveFailed");
  return { ...state, phase: "reserve_failed" };
}

/** Only legal while the number has never been successfully reserved — retries never re-reserve. */
export function retryReserve(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["reserve_failed"], "retryReserve");
  if (state.context.numberReserved) {
    throw new InvalidTransitionError(state.phase, "retryReserve (number already reserved)");
  }
  return { ...state, phase: "reserving" };
}

/**
 * A retry discovered — by re-fetching the work package rather than trusting
 * local state — that the number was already reserved by a previous attempt
 * whose response never reached the client (dropped connection, backgrounded
 * tab, etc). Skips calling reserveNumber a second time and proceeds straight
 * to the same post-reserve step a genuine reserveSucceeded would.
 */
export function reserveAlreadyDone(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["reserving", "reserve_failed"], "reserveAlreadyDone");
  return { ...state, phase: "preview_settling", context: { ...state.context, numberReserved: true } };
}

export function previewSettled(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["preview_settling"], "previewSettled");
  return { ...state, phase: "rendering_pdf" };
}

export function renderSucceeded(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["rendering_pdf"], "renderSucceeded");
  return { ...state, phase: "uploading_pdf" };
}

export function renderFailed(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["rendering_pdf"], "renderFailed");
  return { ...state, phase: "render_failed" };
}

/** Resumes rendering directly — never re-reserves, since the number is already set. */
export function retryRender(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["render_failed"], "retryRender");
  return { ...state, phase: "rendering_pdf" };
}

export function uploadSucceeded(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["uploading_pdf"], "uploadSucceeded");
  return { ...state, phase: "finalizing" };
}

export function uploadFailed(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["uploading_pdf"], "uploadFailed");
  return { ...state, phase: "upload_failed" };
}

/** Resumes uploading directly — never re-renders or re-reserves. */
export function retryUpload(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["upload_failed"], "retryUpload");
  return { ...state, phase: "uploading_pdf" };
}

export function finalizeSucceeded(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["finalizing"], "finalizeSucceeded");
  return { ...state, phase: "done" };
}

export function finalizeFailed(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["finalizing"], "finalizeFailed");
  return { ...state, phase: "finalize_failed" };
}

/** Resumes finalizing directly — never re-uploads, re-renders, or re-reserves. */
export function retryFinalize(state: SessionMachineState): SessionMachineState {
  assertPhase(state, ["finalize_failed"], "retryFinalize");
  return { ...state, phase: "finalizing" };
}
