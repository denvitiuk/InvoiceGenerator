// @vitest-environment jsdom
//
// Integration-level regression tests for the two bugs fixed here:
//   1. /finalize must use the INVOICE's revision (from the reserveNumber
//      response), never the encrypted document's own revision.
//   2. A connected session must survive a page reload by restoring from the
//      editor session already sitting in sessionStorage, without a second
//      exchange — and an expired stored session must show "session expired",
//      never silently fall through to the standalone editor.
// Also covers: a retry after reserveNumber's response was lost never
// reserves a second number.
//
// zeiterfassungApi and the existing renderInvoiceBlob PDF pipeline are
// mocked — this suite never touches a real network endpoint, per the task's
// security requirements. Crypto (Web Crypto + fake-indexeddb) is real.

import "fake-indexeddb/auto";
// jsdom's own Blob polyfill doesn't implement arrayBuffer() (only real
// browsers/Node's buffer.Blob do) — use Node's, which runRenderThroughFinalize
// actually needs to call, so the mocked PDF behaves like a real Blob would.
import { Blob as NodeBlob } from "node:buffer";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkPackageDTO } from "../types";
import { _clearAllKeysForTests } from "../crypto/keyStore";
import { useConnectedInvoiceStore } from "../store/connectedInvoiceStore";
import { clearEditorToken, setEditorSession } from "./editorToken";
import { encryptVaultDto, makeVault, makeWorkPackage as makeFixtureWorkPackage, RECIPIENT } from "../testing/fixtures";

vi.mock("@/lib/api", () => ({
  renderInvoiceBlob: vi.fn(async () => ({
    blob: new NodeBlob(["%PDF-fake"], { type: "application/pdf" }),
    filename: "invoice.pdf",
  })),
}));

vi.mock("@/lib/zeiterfassungApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/zeiterfassungApi")>("@/lib/zeiterfassungApi");
  return {
    ...actual,
    exchangeToken: vi.fn(),
    getWorkPackage: vi.fn(),
    getVault: vi.fn(async () => null),
    saveVault: vi.fn(),
    getDocument: vi.fn(async () => null),
    saveDocument: vi.fn(),
    patchItem: vi.fn(),
    excludeItem: vi.fn(),
    includeItem: vi.fn(),
    reserveNumber: vi.fn(),
    finalizeInvoice: vi.fn(),
  };
});

// Imported *after* the mocks above so it picks up the mocked module.
// eslint-disable-next-line import/first
import { useConnectedSession } from "./useConnectedSession";
// eslint-disable-next-line import/first
import * as zApi from "@/lib/zeiterfassungApi";

const exchangeTokenMock = zApi.exchangeToken as unknown as ReturnType<typeof vi.fn>;
const getWorkPackageMock = zApi.getWorkPackage as unknown as ReturnType<typeof vi.fn>;
const saveDocumentMock = zApi.saveDocument as unknown as ReturnType<typeof vi.fn>;
const getVaultMock = zApi.getVault as unknown as ReturnType<typeof vi.fn>;
const reserveNumberMock = zApi.reserveNumber as unknown as ReturnType<typeof vi.fn>;
const finalizeInvoiceMock = zApi.finalizeInvoice as unknown as ReturnType<typeof vi.fn>;

function futureISO(ms = 10 * 60 * 1000): string {
  return new Date(Date.now() + ms).toISOString();
}

function pastISO(ms = 60 * 1000): string {
  return new Date(Date.now() - ms).toISOString();
}

function makeWorkPackage(overrides: Partial<WorkPackageDTO> = {}): WorkPackageDTO {
  return makeFixtureWorkPackage({
    revision: 5,
    billingProfileRef: "profile-regression",
    issueDate: "2026-02-01",
    dueDate: "2026-02-15",
    ...overrides,
  });
}

function fakeDocumentDto(revision: number) {
  return {
    invoiceId: "inv-1",
    revision,
    vaultProfileVersion: 1,
    encryptionKeyVersion: 1,
    cipherAlgorithm: "AES-256-GCM",
    wrappedDocumentKeyBase64: "AA==",
    documentKeyNonceBase64: "AAAAAAAAAAAAAAAA",
    documentCiphertextBase64: "AA==",
    documentNonceBase64: "AAAAAAAAAAAAAAAA",
    documentSha256Base64: "AA==",
    hasPdf: true,
    updatedAt: new Date().toISOString(),
  };
}

const fullPermissions = { read: true, edit: true, finalize: true };

async function waitForLoadedEditing(result: { current: ReturnType<typeof useConnectedSession> }) {
  await waitFor(() => expect(result.current.loading).toBe(false));
  await waitFor(() => expect(result.current.state.phase).toBe("loaded_editing"));
}

describe("useConnectedSession — finalize revision + reload restore regressions", () => {
  beforeEach(async () => {
    await _clearAllKeysForTests().catch(() => {});
    clearEditorToken();
    window.sessionStorage.clear();
    useConnectedInvoiceStore.getState().reset();
    vi.clearAllMocks();
    getWorkPackageMock.mockResolvedValue(makeWorkPackage());
    // A complete recipient profile for this billingProfileRef, so finalizing
    // isn't blocked by the recipient checks these regressions don't cover.
    const vaultDto = await encryptVaultDto(makeVault({ "profile-regression": { client: RECIPIENT } }), "profile-regression");
    getVaultMock.mockResolvedValue(vaultDto);
  });

  afterEach(() => {
    // Unmounts every hook rendered in the test, which fires each effect's
    // cleanup (clearing any pending autosave timers) instead of letting a
    // stray debounced saveDocument call fire into the next test.
    cleanup();
    vi.clearAllMocks();
  });

  it("finalize's expectedRevision is the reserveNumber response's revision, never the document's own revision", async () => {
    exchangeTokenMock.mockResolvedValue({
      editorAccessToken: "editor-tok-1",
      invoiceId: "inv-1",
      accessExpiresAt: futureISO(),
      permissions: fullPermissions,
    });
    // Deliberately a very different number from the reserve revision, so a
    // regression (using the document revision) is unmistakable.
    reserveNumberMock.mockResolvedValue({ invoiceNumber: "2026-0001", revision: 42 });
    saveDocumentMock.mockResolvedValue(fakeDocumentDto(999));
    finalizeInvoiceMock.mockResolvedValue({ invoiceNumber: "2026-0001", revision: 43 });

    const { result } = renderHook(() => useConnectedSession("one-shot-token"));
    await waitForLoadedEditing(result);

    await act(async () => {
      await result.current.startFinalize();
    });

    await waitFor(() => expect(result.current.state.phase).toBe("done"), { timeout: 3000 });

    expect(finalizeInvoiceMock).toHaveBeenCalledTimes(1);
    const finalizeArgs = finalizeInvoiceMock.mock.calls[0][1];
    expect(finalizeArgs.expectedRevision).toBe(42); // from reserveNumber's response
    expect(finalizeArgs.expectedRevision).not.toBe(999); // never the document's revision
  });

  it("restores connected mode from sessionStorage on reload without calling exchangeToken again", async () => {
    setEditorSession({
      editorAccessToken: "restored-editor-tok",
      accessExpiresAt: futureISO(),
      permissions: fullPermissions,
    });

    const { result } = renderHook(() => useConnectedSession(null));
    await waitForLoadedEditing(result);

    expect(exchangeTokenMock).not.toHaveBeenCalled();
    expect(getWorkPackageMock).toHaveBeenCalledTimes(1);
    expect(result.current.workPackage?.invoiceId).toBe("inv-1");
  });

  it("an expired stored editor session shows session_expired and never reaches loaded_editing (no silent standalone fallback)", async () => {
    setEditorSession({
      editorAccessToken: "stale-editor-tok",
      accessExpiresAt: pastISO(),
      permissions: fullPermissions,
    });

    const { result } = renderHook(() => useConnectedSession(null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.state.phase).toBe("session_expired");
    expect(exchangeTokenMock).not.toHaveBeenCalled();
    expect(getWorkPackageMock).not.toHaveBeenCalled();
  });

  it("a retry after the reserveNumber response was lost never reserves a second number", async () => {
    exchangeTokenMock.mockResolvedValue({
      editorAccessToken: "editor-tok-2",
      invoiceId: "inv-1",
      accessExpiresAt: futureISO(),
      permissions: fullPermissions,
    });
    // First attempt: the network call itself fails client-side...
    reserveNumberMock.mockRejectedValueOnce(new Error("network drop"));
    saveDocumentMock.mockResolvedValue(fakeDocumentDto(500));
    finalizeInvoiceMock.mockResolvedValue({ invoiceNumber: "2026-0007", revision: 8 });

    const { result } = renderHook(() => useConnectedSession("one-shot-token-2"));
    await waitForLoadedEditing(result);

    await act(async () => {
      await result.current.startFinalize();
    });
    await waitFor(() => expect(result.current.state.phase).toBe("reserve_failed"));
    expect(reserveNumberMock).toHaveBeenCalledTimes(1);

    // ...but it actually succeeded server-side. The retry must discover this
    // via a fresh work-package fetch, not by blindly calling reserveNumber again.
    getWorkPackageMock.mockResolvedValue(
      makeWorkPackage({ status: "NUMBER_RESERVED", invoiceNumber: "2026-0007", revision: 7 })
    );

    await act(async () => {
      await result.current.retryAfterFailure();
    });

    await waitFor(() => expect(result.current.state.phase).toBe("done"), { timeout: 3000 });

    // Still only the one (failed) call — the retry never called reserveNumber again.
    expect(reserveNumberMock).toHaveBeenCalledTimes(1);
    expect(result.current.editor.invoice.number).toBe("2026-0007");
    const finalizeArgs = finalizeInvoiceMock.mock.calls[0][1];
    expect(finalizeArgs.expectedRevision).toBe(7); // the invoice revision discovered via refetch, not 500
  });
});
