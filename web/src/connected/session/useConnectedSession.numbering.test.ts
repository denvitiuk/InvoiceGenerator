// @vitest-environment jsdom
//
// Backend-owned numbering, VAT and recipient handling in a full connected
// session. zeiterfassungApi and the PDF renderer are mocked (no network);
// Web Crypto + fake-indexeddb are real, as in the regression suite.

import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _clearAllKeysForTests } from "../crypto/keyStore";
import { useConnectedInvoiceStore } from "../store/connectedInvoiceStore";
import {
  encryptVaultDto,
  makeMixedVatWorkPackage,
  makeVault,
  RECIPIENT,
} from "../testing/fixtures";
import type { ReserveInvoiceNumberResponse, WorkPackageDTO } from "../types";
import { clearEditorToken } from "./editorToken";

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
    overrideNumber: vi.fn(),
    finalizeInvoice: vi.fn(),
  };
});

// eslint-disable-next-line import/first
import { useConnectedSession } from "./useConnectedSession";
// eslint-disable-next-line import/first
import * as zApi from "@/lib/zeiterfassungApi";
// eslint-disable-next-line import/first
import * as pdfApi from "@/lib/api";

const m = <T extends (...args: any[]) => any>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const exchangeTokenMock = m(zApi.exchangeToken);
const getWorkPackageMock = m(zApi.getWorkPackage);
const getVaultMock = m(zApi.getVault);
const saveDocumentMock = m(zApi.saveDocument);
const saveVaultMock = m(zApi.saveVault);
const reserveNumberMock = m(zApi.reserveNumber);
const overrideNumberMock = m(zApi.overrideNumber);
const finalizeInvoiceMock = m(zApi.finalizeInvoice);
const renderInvoiceBlobMock = m(pdfApi.renderInvoiceBlob);

const EDITOR_TOKEN = "editor-secret-token-7f3a";

function numberResult(overrides: Partial<ReserveInvoiceNumberResponse> = {}): ReserveInvoiceNumberResponse {
  return {
    invoiceNumber: "RE-2026-0042",
    revision: 6,
    status: "NUMBER_RESERVED",
    issueDate: "2026-09-23",
    dueDate: "2026-10-07",
    invoiceNumberSource: "SEQUENCE",
    invoiceNumberPatternSnapshot: "RE-{YYYY}-{SEQ:4}",
    ...overrides,
  };
}

function docDto(revision: number) {
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

function conflict(message: string) {
  return new zApi.EditorApiError("conflict", 409, JSON.stringify({ error: message }), message);
}

async function openSession(wp: WorkPackageDTO = makeMixedVatWorkPackage(), withProfile = true) {
  getWorkPackageMock.mockResolvedValue(wp);
  if (withProfile) {
    getVaultMock.mockResolvedValue(
      await encryptVaultDto(makeVault({ [wp.billingProfileRef]: { client: RECIPIENT } }), wp.billingProfileRef)
    );
  }
  const hook = renderHook(() => useConnectedSession("one-shot-token"));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe("connected session — backend numbering, VAT and recipient", () => {
  beforeEach(async () => {
    await _clearAllKeysForTests().catch(() => {});
    clearEditorToken();
    window.sessionStorage.clear();
    window.localStorage.clear();
    useConnectedInvoiceStore.getState().reset();
    vi.clearAllMocks();
    exchangeTokenMock.mockResolvedValue({
      editorAccessToken: EDITOR_TOKEN,
      invoiceId: "inv-1",
      accessExpiresAt: new Date(Date.now() + 600_000).toISOString(),
      permissions: { read: true, edit: true, finalize: true },
    });
    getVaultMock.mockResolvedValue(null);
    saveDocumentMock.mockResolvedValue(docDto(3));
    finalizeInvoiceMock.mockResolvedValue({ invoiceNumber: "RE-2026-0042", revision: 7 });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("invoiceNumber: null stays pending — no number is invented and nothing is reserved on load", async () => {
    const { result } = await openSession();
    expect(result.current.state.phase).toBe("loaded_editing");
    expect(result.current.editor.invoice.number).toBe("");
    expect(result.current.workPackage?.invoiceNumber).toBeNull();
    expect(reserveNumberMock).not.toHaveBeenCalled();
  });

  it("puts the reserved number into InvoiceData and renders the PDF only afterwards", async () => {
    reserveNumberMock.mockResolvedValue(numberResult());
    const { result } = await openSession();

    await act(async () => {
      await result.current.startFinalize();
    });
    await waitFor(() => expect(result.current.state.phase).toBe("done"), { timeout: 3000 });

    expect(reserveNumberMock).toHaveBeenCalledTimes(1);
    expect(reserveNumberMock.mock.calls[0][1]).toMatchObject({ expectedRevision: 5 });
    expect(renderInvoiceBlobMock).toHaveBeenCalledTimes(1);
    expect(reserveNumberMock.mock.invocationCallOrder[0]).toBeLessThan(renderInvoiceBlobMock.mock.invocationCallOrder[0]);

    const rendered = renderInvoiceBlobMock.mock.calls[0][0];
    expect(rendered.number).toBe("RE-2026-0042");
    expect(rendered.issueDateISO).toBe("2026-09-23");
    expect(rendered.dueDateISO).toBe("2026-10-07");
    expect(rendered.client).toEqual(RECIPIENT);
    expect(result.current.editor.invoice.number).toBe("RE-2026-0042");

    // Finalize sends the backend totals and the reserve response's invoice revision.
    expect(finalizeInvoiceMock.mock.calls[0][1]).toEqual({
      expectedRevision: 6,
      finalNetAmount: "320.00",
      finalVatAmount: "41.20",
      finalGrossAmount: "361.20",
    });
  });

  it("never renders a PDF when the reservation fails, and keeps the dialog state with the backend message", async () => {
    reserveNumberMock.mockRejectedValue(conflict("Invoice still requires review"));
    const { result } = await openSession();

    await act(async () => {
      await result.current.startFinalize();
    });

    expect(result.current.state.phase).toBe("reserve_failed");
    expect(result.current.flowError).toMatchObject({ kind: "conflict", serverMessage: "Invoice still requires review" });
    expect(renderInvoiceBlobMock).not.toHaveBeenCalled();
    expect(saveDocumentMock.mock.calls.some((c) => c[1]?.pdfCiphertextBase64)).toBe(false);
    expect(finalizeInvoiceMock).not.toHaveBeenCalled();
    expect(result.current.editor.invoice.number).toBe("");
  });

  it("a retry first re-reads the work package; if that fails it does not reserve again", async () => {
    reserveNumberMock.mockRejectedValueOnce(new zApi.EditorApiError("network_error", undefined, "Network request failed"));
    const { result } = await openSession();

    await act(async () => {
      await result.current.startFinalize();
    });
    expect(result.current.state.phase).toBe("reserve_failed");

    getWorkPackageMock.mockRejectedValueOnce(new zApi.EditorApiError("network_error", undefined, "Network request failed"));
    await act(async () => {
      await result.current.retryAfterFailure();
    });

    expect(result.current.state.phase).toBe("reserve_failed");
    expect(reserveNumberMock).toHaveBeenCalledTimes(1);
    expect(renderInvoiceBlobMock).not.toHaveBeenCalled();
  });

  it("a retry that finds the number already reserved uses it and never reserves a second one", async () => {
    reserveNumberMock.mockRejectedValueOnce(new zApi.EditorApiError("network_error", undefined, "Network request failed"));
    const { result } = await openSession();
    await act(async () => {
      await result.current.startFinalize();
    });

    getWorkPackageMock.mockResolvedValue(
      makeMixedVatWorkPackage({ status: "NUMBER_RESERVED", invoiceNumber: "RE-2026-0042", revision: 6, issueDate: "2026-09-23", dueDate: "2026-10-07", invoiceNumberSource: "SEQUENCE" })
    );
    await act(async () => {
      await result.current.retryAfterFailure();
    });
    await waitFor(() => expect(result.current.state.phase).toBe("done"), { timeout: 3000 });

    expect(reserveNumberMock).toHaveBeenCalledTimes(1);
    expect(renderInvoiceBlobMock.mock.calls[0][0].number).toBe("RE-2026-0042");
    expect(finalizeInvoiceMock.mock.calls[0][1].expectedRevision).toBe(6);
  });

  it("a double click starts exactly one finalize flow", async () => {
    reserveNumberMock.mockResolvedValue(numberResult());
    const { result } = await openSession();

    await act(async () => {
      await Promise.all([result.current.startFinalize(), result.current.startFinalize()]);
    });
    await waitFor(() => expect(result.current.state.phase).toBe("done"), { timeout: 3000 });

    expect(reserveNumberMock).toHaveBeenCalledTimes(1);
    expect(renderInvoiceBlobMock).toHaveBeenCalledTimes(1);
    expect(finalizeInvoiceMock).toHaveBeenCalledTimes(1);
  });

  it("manual override updates number, revision and source without a reload, and finalize then skips reservation", async () => {
    overrideNumberMock.mockResolvedValue(numberResult({ invoiceNumber: "RE-2026-0100", revision: 9, invoiceNumberSource: "MANUAL" }));
    const { result } = await openSession();

    let outcome: Awaited<ReturnType<typeof result.current.overrideInvoiceNumber>> | undefined;
    await act(async () => {
      outcome = await result.current.overrideInvoiceNumber("  RE-2026-0100 ");
    });

    expect(outcome).toEqual({ ok: true, invoiceNumber: "RE-2026-0100", revision: 9 });
    expect(overrideNumberMock.mock.calls[0][1]).toMatchObject({ expectedRevision: 5, invoiceNumber: "RE-2026-0100" });
    expect(result.current.editor.invoice.number).toBe("RE-2026-0100");
    expect(result.current.workPackage).toMatchObject({ invoiceNumber: "RE-2026-0100", revision: 9, invoiceNumberSource: "MANUAL", status: "NUMBER_RESERVED" });
    expect(getWorkPackageMock).toHaveBeenCalledTimes(1); // no reload

    await act(async () => {
      await result.current.startFinalize();
    });
    await waitFor(() => expect(result.current.state.phase).toBe("done"), { timeout: 3000 });
    expect(reserveNumberMock).not.toHaveBeenCalled();
    expect(renderInvoiceBlobMock.mock.calls[0][0].number).toBe("RE-2026-0100");
    expect(finalizeInvoiceMock.mock.calls[0][1].expectedRevision).toBe(9);
  });

  it("a duplicate/revision conflict on override is reported, re-reads the work package and never fakes success", async () => {
    overrideNumberMock.mockRejectedValue(conflict("Invoice number already in use"));
    const { result } = await openSession();

    let outcome: Awaited<ReturnType<typeof result.current.overrideInvoiceNumber>> | undefined;
    await act(async () => {
      outcome = await result.current.overrideInvoiceNumber("RE-2026-0001");
    });

    expect(outcome).toEqual({ ok: false, reason: "conflict", serverMessage: "Invoice number already in use" });
    expect(result.current.editor.invoice.number).toBe("");
    expect(result.current.workPackage?.invoiceNumber).toBeNull();
    expect(getWorkPackageMock).toHaveBeenCalledTimes(2); // initial load + re-read after 409
  });

  it("rejects an invalid manual number locally without calling the backend", async () => {
    const { result } = await openSession();
    let outcome: Awaited<ReturnType<typeof result.current.overrideInvoiceNumber>> | undefined;
    await act(async () => {
      outcome = await result.current.overrideInvoiceNumber("-bad number");
    });
    expect(outcome).toMatchObject({ ok: false, reason: "invalid_format" });
    expect(overrideNumberMock).not.toHaveBeenCalled();
  });

  it.each(["FINALIZED", "SENT", "PAID", "CANCELLED"])("after %s the number can no longer be changed", async (status) => {
    const { result } = await openSession(makeMixedVatWorkPackage({ status, invoiceNumber: "RE-2026-0042", invoiceNumberSource: "SEQUENCE" }));
    expect(result.current.state.phase).toBe("locked_finalized");

    let outcome: Awaited<ReturnType<typeof result.current.overrideInvoiceNumber>> | undefined;
    await act(async () => {
      outcome = await result.current.overrideInvoiceNumber("RE-2026-9999");
    });
    expect(outcome).toMatchObject({ ok: false, reason: "immutable" });
    expect(overrideNumberMock).not.toHaveBeenCalled();
    expect(result.current.editor.invoice.number).toBe("RE-2026-0042");
  });

  it("uses the vault profile of the current billingProfileRef, never another customer's", async () => {
    const other = { name: "Andere Kunde AG", addressLines: ["Fremdweg 9", "10115 Berlin"] };
    const wp = makeMixedVatWorkPackage({ billingProfileRef: "profile-A" });
    getWorkPackageMock.mockResolvedValue(wp);
    getVaultMock.mockResolvedValue(
      await encryptVaultDto(makeVault({ "profile-B": { client: other }, "profile-A": { client: RECIPIENT } }), "profile-A")
    );
    const { result } = renderHook(() => useConnectedSession("one-shot-token"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.hasProfileForBillingRef).toBe(true);
    expect(result.current.editor.invoice.client).toEqual(RECIPIENT);
  });

  it("without a profile for this billingProfileRef the recipient stays empty and finalizing is blocked", async () => {
    const { result } = await openSession(makeMixedVatWorkPackage(), false);

    expect(result.current.hasProfileForBillingRef).toBe(false);
    expect(result.current.editor.invoice.client.name).toBe("");
    expect(result.current.finalizeBlockers).toEqual(
      expect.arrayContaining(["recipient_profile_missing", "recipient_name_missing", "recipient_address_missing"])
    );

    await act(async () => {
      await result.current.startFinalize();
    });
    expect(reserveNumberMock).not.toHaveBeenCalled();
    expect(result.current.flowError?.kind).toBe("blocked");
  });

  it("an incompatible work package shows a contract error instead of a half-valid invoice", async () => {
    getWorkPackageMock.mockRejectedValue(
      new zApi.EditorApiError("invalid_contract", undefined, "Incompatible work package", "totals: expected object")
    );
    const { result } = renderHook(() => useConnectedSession("one-shot-token"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.state.phase).toBe("exchange_error");
    expect(result.current.state.errorKind).toBe("invalid_contract");
    expect(result.current.loadErrorDetail).toBe("totals: expected object");
  });

  it("tokens, keys and decrypted recipient details never reach logs, URLs or localStorage", async () => {
    const logged: string[] = [];
    const capture = (...args: unknown[]) => logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(capture));
    try {
      reserveNumberMock.mockRejectedValueOnce(conflict("Revision conflict"));
      const { result } = await openSession();
      await act(async () => {
        await result.current.startFinalize();
      });
      reserveNumberMock.mockResolvedValue(numberResult());
      await act(async () => {
        await result.current.retryAfterFailure();
      });
      await waitFor(() => expect(result.current.state.phase).toBe("done"), { timeout: 3000 });

      const everything = [logged.join("\n"), window.location.href, JSON.stringify({ ...window.localStorage })].join("\n");
      for (const secret of [EDITOR_TOKEN, "one-shot-token", RECIPIENT.name, ...RECIPIENT.addressLines, RECIPIENT.ustId, "DE02120300000000202051"]) {
        expect(everything).not.toContain(secret);
      }
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  it("downloads the final PDF under a safe file name while the number itself keeps its '/'", async () => {
    reserveNumberMock.mockResolvedValue(numberResult({ invoiceNumber: "RE/2026/0042" }));
    finalizeInvoiceMock.mockResolvedValue({ invoiceNumber: "RE/2026/0042", revision: 7 });
    const { result } = await openSession();
    await act(async () => {
      await result.current.startFinalize();
    });
    await waitFor(() => expect(result.current.state.phase).toBe("done"), { timeout: 3000 });
    expect(renderInvoiceBlobMock.mock.calls[0][0].number).toBe("RE/2026/0042");

    const downloads: string[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    const createUrl = vi.fn(() => "blob:fake");
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createUrl as never;
    URL.revokeObjectURL = vi.fn() as never;
    try {
      act(() => result.current.downloadFinalPdf());
      expect(downloads).toEqual(["rechnung-RE-2026-0042.pdf"]);
      await new Promise((resolve) => setTimeout(resolve, 0)); // deferred revokeObjectURL
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
  it("concurrent vault + document autosaves run one after another instead of crashing the session", async () => {
    saveVaultMock.mockImplementation(async (_tok: string, body: { expectedRevision: number; profileVersion: number }) => ({
      companyId: 7,
      revision: body.expectedRevision + 1,
      profileVersion: body.profileVersion,
      cipherAlgorithm: "AES-256-GCM",
      encryptedPayloadBase64: "AA==",
      payloadNonceBase64: "AAAAAAAAAAAAAAAA",
      ciphertextSha256Base64: "AA==",
      updatedAt: new Date().toISOString(),
    }));
    const { result } = await openSession();

    // One client edit arms both debounced autosaves for the same tick.
    // (The first change after loading is deliberately skipped by the vault autosave.)
    act(() => result.current.editor.patchClient({ addressLines: ["Neue Straße 1"] }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    act(() => result.current.editor.patchClient({ addressLines: ["Neue Straße 1", "20095 Hamburg"] }));
    await waitFor(() => expect(saveVaultMock).toHaveBeenCalledTimes(1), { timeout: 4000 });
    await waitFor(() => expect(saveDocumentMock).toHaveBeenCalled(), { timeout: 4000 });
    await waitFor(() => expect(result.current.state.phase).toBe("loaded_editing"));
    expect(result.current.saveState).toBe("saved");
    // strictly sequential: the document save started only after the vault save resolved
    expect(saveVaultMock.mock.invocationCallOrder[0]).toBeLessThan(saveDocumentMock.mock.invocationCallOrder[0]);
  });
});
