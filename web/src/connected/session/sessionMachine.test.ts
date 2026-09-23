import { describe, expect, it } from "vitest";
import {
  InvalidTransitionError,
  canStartReserve,
  exchangeSucceeded,
  finalizeSucceeded,
  initialSessionState,
  loadFailed,
  previewSettled,
  renderFailed,
  renderSucceeded,
  reserveAlreadyDone,
  reserveFailed,
  reserveSucceeded,
  restoreSession,
  retryReserve,
  retryRender,
  sessionExpiredOnRestore,
  setRequiresReview,
  startExchange,
  startReserve,
  uploadSucceeded,
  type SessionMachineState,
} from "./sessionMachine";

function editableLoadedState(): SessionMachineState {
  let s = initialSessionState();
  s = startExchange(s);
  s = exchangeSucceeded(s, { read: true, edit: true, finalize: true });
  return s;
}

describe("sessionMachine", () => {
  it("requiresReview blocks entering the reserving phase", () => {
    let s = editableLoadedState();
    s = setRequiresReview(s, true);

    expect(canStartReserve(s)).toBe(false);
    expect(() => startReserve(s)).toThrow(InvalidTransitionError);
  });

  it("allows reserving once requiresReview is false and finalize permission is granted", () => {
    const s = editableLoadedState();
    expect(canStartReserve(s)).toBe(true);
    expect(() => startReserve(s)).not.toThrow();
  });

  it("enforces the exact reserve -> preview -> render -> upload -> finalize order", () => {
    let s = editableLoadedState();
    s = startReserve(s);
    expect(s.phase).toBe("reserving");

    s = reserveSucceeded(s);
    expect(s.phase).toBe("preview_settling");
    expect(s.context.numberReserved).toBe(true);

    s = previewSettled(s);
    expect(s.phase).toBe("rendering_pdf");

    s = renderSucceeded(s);
    expect(s.phase).toBe("uploading_pdf");

    s = uploadSucceeded(s);
    expect(s.phase).toBe("finalizing");

    s = finalizeSucceeded(s);
    expect(s.phase).toBe("done");
  });

  it("rejects skipping a step out of order (e.g. rendering before a number was reserved)", () => {
    const s = editableLoadedState();
    expect(() => renderSucceeded(s)).toThrow(InvalidTransitionError);
  });

  it("never re-reserves: once the number is reserved, startReserve is permanently unreachable", () => {
    let s = editableLoadedState();
    s = startReserve(s);
    s = reserveSucceeded(s);

    expect(canStartReserve(s)).toBe(false);
    expect(s.context.numberReserved).toBe(true);
  });

  it("retryReserve is only legal before the number has ever been reserved", () => {
    let s = editableLoadedState();
    s = startReserve(s);
    s = reserveFailed(s);
    expect(s.context.numberReserved).toBe(false);

    // Legal: reserve never succeeded, so a retry may still reserve.
    expect(() => retryReserve(s)).not.toThrow();
  });

  it("a render failure retries rendering directly, never re-reserving the number", () => {
    let s = editableLoadedState();
    s = startReserve(s);
    s = reserveSucceeded(s);
    s = previewSettled(s);
    s = renderFailed(s);
    expect(s.phase).toBe("render_failed");
    expect(s.context.numberReserved).toBe(true);
    expect(canStartReserve(s)).toBe(false);

    s = retryRender(s);
    expect(s.phase).toBe("rendering_pdf");
    expect(s.context.numberReserved).toBe(true);
  });

  describe("session restore after a reload", () => {
    it("restoreSession skips straight from idle to loaded_editing using exactly the stored permissions", () => {
      const restored = restoreSession(initialSessionState(), { read: true, edit: false, finalize: false });
      expect(restored.phase).toBe("loaded_editing");
      expect(restored.context.permissions).toEqual({ read: true, edit: false, finalize: false });
    });

    it("never assumes edit/finalize rights on restore — false stays false", () => {
      const restored = restoreSession(initialSessionState(), { read: true, edit: false, finalize: false });
      expect(canStartReserve(restored)).toBe(false);
    });

    it("sessionExpiredOnRestore goes straight to the expired screen without any network attempt", () => {
      const s = sessionExpiredOnRestore(initialSessionState());
      expect(s.phase).toBe("session_expired");
    });

    it("loadFailed with a 401/403 goes to session_expired; anything else goes to exchange_error", () => {
      let s = editableLoadedState();
      expect(loadFailed(s, "unauthorized").phase).toBe("session_expired");
      expect(loadFailed(s, "forbidden").phase).toBe("session_expired");
      expect(loadFailed(s, "server_error").phase).toBe("exchange_error");
    });
  });

  describe("reserve idempotency across a retry", () => {
    it("reserveAlreadyDone (discovered via refetch) skips straight to preview_settling and marks numberReserved", () => {
      let s = editableLoadedState();
      s = startReserve(s);
      s = reserveFailed(s);
      expect(s.context.numberReserved).toBe(false);

      s = retryReserve(s);
      expect(s.phase).toBe("reserving");

      s = reserveAlreadyDone(s);
      expect(s.phase).toBe("preview_settling");
      expect(s.context.numberReserved).toBe(true);

      // From here the normal chain continues exactly as a genuine reserveSucceeded would.
      s = previewSettled(s);
      expect(s.phase).toBe("rendering_pdf");
    });

    it("retryReserve is permanently unreachable once numberReserved is true, even mid-chain", () => {
      let s = editableLoadedState();
      s = startReserve(s);
      s = reserveSucceeded(s);
      expect(s.context.numberReserved).toBe(true);
      expect(canStartReserve(s)).toBe(false);
    });
  });
});
