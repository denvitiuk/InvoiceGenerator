// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearEditorToken,
  getEditorSession,
  getEditorToken,
  hasStoredSession,
  isSessionExpired,
  peekStoredSession,
  setEditorSession,
} from "./editorToken";

function futureISO(ms = 5 * 60 * 1000): string {
  return new Date(Date.now() + ms).toISOString();
}

function pastISO(ms = 5 * 60 * 1000): string {
  return new Date(Date.now() - ms).toISOString();
}

describe("editorToken session storage", () => {
  beforeEach(() => {
    clearEditorToken();
    window.sessionStorage.clear();
  });

  it("round-trips a valid session through sessionStorage", () => {
    setEditorSession({
      editorAccessToken: "tok-abc",
      accessExpiresAt: futureISO(),
      permissions: { read: true, edit: true, finalize: true },
    });

    expect(getEditorToken()).toBe("tok-abc");
    expect(getEditorSession()?.permissions).toEqual({ read: true, edit: true, finalize: true });

    const raw = window.sessionStorage.getItem("invoice.connected.editorSession");
    expect(raw).toBeTruthy();
    expect(raw).not.toContain("localStorage"); // sanity: never mirrored to localStorage
  });

  it("never stores anything in localStorage", () => {
    setEditorSession({
      editorAccessToken: "tok-abc",
      accessExpiresAt: futureISO(),
      permissions: { read: true, edit: true, finalize: true },
    });
    expect(window.localStorage.length).toBe(0);
  });

  it("getEditorSession returns null and clears storage once the session has expired", () => {
    setEditorSession({
      editorAccessToken: "tok-expired",
      accessExpiresAt: pastISO(),
      permissions: { read: true, edit: true, finalize: true },
    });

    expect(getEditorSession()).toBeNull();
    expect(getEditorToken()).toBeNull();
    expect(window.sessionStorage.getItem("invoice.connected.editorSession")).toBeNull();
  });

  it("peekStoredSession still returns an expired record without clearing it — hasStoredSession stays true", () => {
    setEditorSession({
      editorAccessToken: "tok-expired",
      accessExpiresAt: pastISO(),
      permissions: { read: true, edit: true, finalize: true },
    });

    const peeked = peekStoredSession();
    expect(peeked?.editorAccessToken).toBe("tok-expired");
    expect(isSessionExpired(peeked!)).toBe(true);
    expect(hasStoredSession()).toBe(true);
  });

  it("hasStoredSession is false once nothing was ever stored", () => {
    expect(hasStoredSession()).toBe(false);
    expect(peekStoredSession()).toBeNull();
  });

  it("clearEditorToken removes the stored record entirely", () => {
    setEditorSession({
      editorAccessToken: "tok-abc",
      accessExpiresAt: futureISO(),
      permissions: { read: true, edit: true, finalize: true },
    });
    clearEditorToken();
    expect(hasStoredSession()).toBe(false);
    expect(getEditorToken()).toBeNull();
  });
});
