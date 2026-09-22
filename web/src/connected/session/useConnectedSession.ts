// Orchestrates a connected-invoice session: wires sessionMachine transitions to
// zeiterfassungApi calls and the crypto/vault/document modules. This is the one
// place that understands the full flow end-to-end; UI components only ever read
// `ConnectedSessionValue` and call its action methods.

import { useCallback, useEffect, useRef, useState } from "react";
import type { UILang } from "@/lib/i18n";
import { renderInvoiceBlob } from "@/lib/api";
import type { ClientInfo, CompanyInfo, Currency, InvoiceData } from "@/types/invoice";
import {
  EditorApiError,
  excludeItem as apiExcludeItem,
  exchangeToken,
  finalizeInvoice as apiFinalizeInvoice,
  getDocument,
  getVault,
  getWorkPackage,
  includeItem as apiIncludeItem,
  patchItem as apiPatchItem,
  reserveNumber as apiReserveNumber,
  saveDocument as apiSaveDocument,
  saveVault as apiSaveVault,
} from "@/lib/zeiterfassungApi";
import { cdbg } from "../debug";
import {
  decryptPdf,
  decryptDocument,
  encryptDocument,
  encryptPdf,
  generateDocumentKey,
  unwrapDocumentKey,
  wrapDocumentKey,
} from "../document/documentCodec";
import { getFinalizedDocument, saveFinalizedDocument } from "../crypto/finalizedDocumentStore";
import { getExistingMasterKey, getOrCreateMasterKey, isIndexedDbAvailable } from "../crypto/keyStore";
import { isWebCryptoAvailable } from "../crypto/webCrypto";
import { sumDecimalStrings } from "../mapping/money";
import { useConnectedInvoiceStore } from "../store/connectedInvoiceStore";
import type { EditorPermissions, SessionMachineState } from "./sessionMachine";
import {
  exchangeFailed,
  exchangeSucceeded,
  finalizeFailed,
  finalizeSucceeded,
  initialSessionState,
  loadFailed,
  lockAsFinalized,
  markUnsupportedBrowser,
  markVaultUnavailable,
  openReconnectScreen,
  previewSettled,
  renderFailed,
  renderSucceeded,
  reserveAlreadyDone,
  reserveFailed,
  reserveSucceeded,
  restoreSession,
  resumeEditing,
  saveGenericError,
  sessionExpiredOnRestore,
  retryFinalize,
  retryRender,
  retryReserve,
  retryUpload,
  saveConflict,
  saveSessionExpired,
  saveSucceeded,
  saveWentOffline,
  setRequiresReview,
  startExchange,
  startReserve,
  startSavingDocument,
  startSavingVault,
  uploadFailed,
  uploadSucceeded,
} from "./sessionMachine";
import { clearEditorToken, getEditorToken, isSessionExpired, peekStoredSession, setEditorSession } from "./editorToken";
import { decryptVault, encryptVault } from "../vault/vaultCodec";
import { makeEmptyVault, type InvoiceVault } from "../vault/vaultTypes";
import { buildVaultImportCandidate, type VaultImportCandidate } from "../vault/vaultImport";
import type { WorkPackageDTO } from "../types";

const AUTOSAVE_DEBOUNCE_MS = 1200;
const PREVIEW_SETTLE_MS = 400; // strictly longer than PreviewPane's debounceMs=250

export type SaveState = "idle" | "saving" | "saved" | "offline" | "conflict" | "error";

export interface ConnectedEditorAdapter {
  invoice: InvoiceData;
  invoiceLang: UILang;
  setInvoiceLang: (lang: UILang) => void;
  setCurrency: (cur: Currency) => void;
  setDueDays: (days: number) => void;
  patchCompany: (patch: Partial<CompanyInfo>) => void;
  patchClient: (patch: Partial<ClientInfo>) => void;
  patchInvoice: (patch: Partial<InvoiceData>) => void;
}

export interface ConnectedSessionValue {
  state: SessionMachineState;
  loading: boolean;
  workPackage: WorkPackageDTO | null;
  editor: ConnectedEditorAdapter;
  saveState: SaveState;
  accessExpiresAt: string | null;
  finalPdfBlob: Blob | null;
  vaultImportCandidate: VaultImportCandidate | null;
  billingProfileRef: string | null;
  hasProfileForBillingRef: boolean;

  reconnect: (invoiceId: string, shortCode: string) => Promise<void>;
  openReconnect: () => void;
  patchServerItem: (itemId: string, patch: { description?: string; workType?: string; quantity?: number; unit?: string; unitPrice?: number }) => Promise<void>;
  excludeServerItem: (itemId: string) => Promise<void>;
  includeServerItem: (itemId: string) => Promise<void>;
  addManualLine: ReturnType<typeof useConnectedInvoiceStore.getState>["addManualLine"];
  updateManualLine: ReturnType<typeof useConnectedInvoiceStore.getState>["updateManualLine"];
  removeManualLine: ReturnType<typeof useConnectedInvoiceStore.getState>["removeManualLine"];
  importVaultFromTemplate: () => void;
  dismissVaultImportCandidate: () => void;
  createNewLocalProfile: () => Promise<void>;
  startFinalize: () => Promise<void>;
  retryAfterFailure: () => Promise<void>;
  downloadFinalPdf: () => void;
}

export function useConnectedSession(token: string | null): ConnectedSessionValue {
  const [state, setState] = useState<SessionMachineState>(initialSessionState());
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [accessExpiresAt, setAccessExpiresAt] = useState<string | null>(null);
  const [finalPdfBlob, setFinalPdfBlob] = useState<Blob | null>(null);
  const [vaultImportCandidate, setVaultImportCandidate] = useState<VaultImportCandidate | null>(null);
  const [hasProfileForBillingRef, setHasProfileForBillingRef] = useState(false);

  const invoice = useConnectedInvoiceStore((s) => s.invoice);
  const invoiceLang = useConnectedInvoiceStore((s) => s.invoiceLang);
  const workPackage = useConnectedInvoiceStore((s) => s.workPackage);
  const storeSetInvoiceLang = useConnectedInvoiceStore((s) => s.setInvoiceLang);
  const storeSetCurrency = useConnectedInvoiceStore((s) => s.setCurrency);
  const storeSetDueDays = useConnectedInvoiceStore((s) => s.setDueDays);
  const storePatchCompany = useConnectedInvoiceStore((s) => s.patchCompany);
  const storePatchClient = useConnectedInvoiceStore((s) => s.patchClient);
  const storePatchInvoice = useConnectedInvoiceStore((s) => s.patchInvoice);

  const masterKeyRef = useRef<CryptoKey | null>(null);
  const documentKeyRef = useRef<CryptoKey | null>(null);
  const vaultRef = useRef<InvoiceVault>(makeEmptyVault());
  const vaultRevisionRef = useRef(0);
  const vaultProfileVersionRef = useRef(1);
  const documentRevisionRef = useRef(0);
  // The INVOICE's own revision (Invoices.revision on the backend) — a
  // completely separate counter from documentRevisionRef (EncryptedInvoiceDocuments.revision).
  // reserveNumber and finalize both key their optimistic lock off this one; a
  // document save's returned revision must never be used here (see
  // runRenderThroughFinalize).
  const invoiceRevisionRef = useRef(0);
  const billingProfileRefRef = useRef<string | null>(null);
  const invoiceIdRef = useRef<string | null>(null);
  const skipNextAutosaveRef = useRef(true);
  const vaultSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const documentSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reportKind = useCallback((e: unknown): "unauthorized" | "forbidden" | "not_found" | "conflict" | "rate_limited" | "server_error" | "network_error" => {
    if (e instanceof EditorApiError) {
      if (e.kind === "not_configured") return "server_error";
      return e.kind;
    }
    return "network_error";
  }, []);

  // --- Initial exchange (fresh URL token) or restore (reload within the same
  // tab, using the editor session already sitting in sessionStorage) --------
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!isWebCryptoAvailable() || !isIndexedDbAvailable()) {
        if (!cancelled) {
          setState((s) => markUnsupportedBrowser(s));
          setLoading(false);
        }
        return;
      }

      if (token) {
        setState((s) => startExchange(s));
        let permissions: EditorPermissions;
        try {
          const resp = await exchangeToken({ token });
          if (cancelled) return;
          setEditorSession({
            editorAccessToken: resp.editorAccessToken,
            accessExpiresAt: resp.accessExpiresAt,
            permissions: resp.permissions,
          });
          setAccessExpiresAt(resp.accessExpiresAt);
          permissions = resp.permissions;
        } catch (e) {
          if (!cancelled) {
            setState((s) => exchangeFailed(s, reportKind(e)));
            setLoading(false);
          }
          return;
        }

        setState((s) => exchangeSucceeded(s, permissions));
        if (!permissions.read) {
          setLoading(false);
          return;
        }

        await loadEverything();
        if (!cancelled) setLoading(false);
        return;
      }

      // No fresh one-shot token — this is a page load, not the original
      // hand-off navigation. Only ever resume a connected session that
      // ClientApp already found evidence of (a stored session record); never
      // attempt to exchange anything here.
      const stored = peekStoredSession();
      if (!stored) {
        setLoading(false);
        return;
      }
      if (isSessionExpired(stored)) {
        clearEditorToken();
        setState((s) => sessionExpiredOnRestore(s));
        setLoading(false);
        return;
      }

      setAccessExpiresAt(stored.accessExpiresAt);
      // Permissions come from exactly what was issued at the original
      // exchange — never assumed/defaulted while restoring.
      setState((s) => restoreSession(s, stored.permissions));
      if (!stored.permissions.read) {
        setLoading(false);
        return;
      }

      await loadEverything();
      if (!cancelled) setLoading(false);
    }

    async function loadEverything() {
      const editorToken = getEditorToken();
      if (!editorToken) return;

      let wp: WorkPackageDTO;
      try {
        wp = await getWorkPackage(editorToken);
      } catch (e) {
        const kind = reportKind(e);
        cdbg("useConnectedSession.loadWorkPackage.failed", { kind });
        if (kind === "unauthorized" || kind === "forbidden") clearEditorToken();
        setState((s) => loadFailed(s, kind));
        return;
      }
      if (cancelled) return;

      invoiceIdRef.current = wp.invoiceId;
      invoiceRevisionRef.current = wp.revision;
      useConnectedInvoiceStore.getState().setWorkPackage(wp);
      billingProfileRefRef.current = wp.billingProfileRef;
      const anyLineNeedsReview = wp.lines.some((l) => l.requiresReview && !l.isExcluded);
      setState((s) => setRequiresReview(s, wp.requiresReview || anyLineNeedsReview));

      if (wp.status === "FINALIZED") {
        setState((s) => lockAsFinalized(s));
        return;
      }

      const masterKey = await getOrCreateMasterKey(wp.billingProfileRef);

      let remoteVaultExists = false;
      try {
        const vaultDto = await getVault(editorToken);
        if (vaultDto) {
          remoteVaultExists = true;
          vaultRevisionRef.current = vaultDto.revision;
          vaultProfileVersionRef.current = vaultDto.profileVersion;
          const existingKey = await getExistingMasterKey(wp.billingProfileRef);
          const decrypted = existingKey ? await decryptVault(vaultDto, existingKey) : { ok: false as const, reason: "cannot-open" as const };
          if (!decrypted.ok) {
            setState((s) => markVaultUnavailable(s));
            return;
          }
          vaultRef.current = decrypted.vault;
          masterKeyRef.current = existingKey;
        } else {
          vaultRevisionRef.current = 0;
          vaultRef.current = makeEmptyVault();
          masterKeyRef.current = masterKey;
        }
      } catch (e) {
        const kind = reportKind(e);
        cdbg("useConnectedSession.loadVault.failed", { kind });
        if (kind === "unauthorized" || kind === "forbidden") {
          clearEditorToken();
          setState((s) => loadFailed(s, kind));
          return;
        }
        vaultRef.current = makeEmptyVault();
        masterKeyRef.current = masterKey;
      }

      const profile = vaultRef.current.profiles[wp.billingProfileRef];
      setHasProfileForBillingRef(Boolean(profile));
      if (profile) {
        useConnectedInvoiceStore.getState().applyVaultProfile(profile, vaultRef.current.company, true);
      } else if (!remoteVaultExists) {
        setVaultImportCandidate(buildVaultImportCandidate());
      }

      try {
        const docDto = await getDocument(editorToken);
        if (docDto && masterKeyRef.current) {
          documentRevisionRef.current = docDto.revision;
          const docKey = await unwrapDocumentKey(docDto.wrappedDocumentKeyBase64, docDto.documentKeyNonceBase64, masterKeyRef.current);
          documentKeyRef.current = docKey;
          const plaintext = await decryptDocument(docDto.documentCiphertextBase64, docDto.documentNonceBase64, docKey);
          useConnectedInvoiceStore.getState().loadDocumentSnapshot(plaintext);
        } else {
          documentRevisionRef.current = 0;
          documentKeyRef.current = await generateDocumentKey();
        }
      } catch (e) {
        const kind = reportKind(e);
        cdbg("useConnectedSession.loadDocument.failed", { kind });
        if (kind === "unauthorized" || kind === "forbidden") {
          clearEditorToken();
          setState((s) => loadFailed(s, kind));
          return;
        }
        documentKeyRef.current = documentKeyRef.current ?? (await generateDocumentKey());
      }

      skipNextAutosaveRef.current = true;
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // --- Debounced vault autosave (company + this profile's client/dueDays) -
  useEffect(() => {
    if (state.phase !== "loaded_editing") return;
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }
    if (vaultSaveTimerRef.current) clearTimeout(vaultSaveTimerRef.current);
    vaultSaveTimerRef.current = setTimeout(() => {
      void saveVaultNow();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (vaultSaveTimerRef.current) clearTimeout(vaultSaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice.company, invoice.client]);

  // --- Debounced document autosave (manual lines, order, notes/theme/etc) -
  useEffect(() => {
    if (state.phase !== "loaded_editing") return;
    if (documentSaveTimerRef.current) clearTimeout(documentSaveTimerRef.current);
    documentSaveTimerRef.current = setTimeout(() => {
      void saveDocumentNow();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (documentSaveTimerRef.current) clearTimeout(documentSaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice, useConnectedInvoiceStore.getState().manualLines, useConnectedInvoiceStore.getState().order]);

  const saveVaultNow = useCallback(async () => {
    const editorToken = getEditorToken();
    const profileRef = billingProfileRefRef.current;
    const masterKey = masterKeyRef.current;
    if (!editorToken || !profileRef || !masterKey) return;

    const currentInvoice = useConnectedInvoiceStore.getState().invoice;
    const nextVault: InvoiceVault = {
      ...vaultRef.current,
      company: currentInvoice.company,
      profiles: {
        ...vaultRef.current.profiles,
        [profileRef]: {
          ...(vaultRef.current.profiles[profileRef] ?? {}),
          client: currentInvoice.client,
          dueDays: currentInvoice.dueDays,
          theme: currentInvoice.theme,
        },
      },
    };

    setState((s) => startSavingVault(s));
    setSaveState("saving");
    try {
      const body = await encryptVault(nextVault, masterKey, {
        expectedRevision: vaultRevisionRef.current,
        profileVersion: vaultProfileVersionRef.current,
      });
      const dto = await apiSaveVault(editorToken, body);
      vaultRef.current = nextVault;
      vaultRevisionRef.current = dto.revision;
      setHasProfileForBillingRef(true);
      setState((s) => saveSucceeded(s));
      setSaveState("saved");
    } catch (e) {
      const kind = reportKind(e);
      if (kind === "conflict") {
        setState((s) => saveConflict(s, "vault"));
        setSaveState("conflict");
      } else if (kind === "network_error") {
        setState((s) => saveWentOffline(s));
        setSaveState("offline");
      } else if (kind === "unauthorized" || kind === "forbidden") {
        setState((s) => saveSessionExpired(s));
        clearEditorToken();
      } else {
        setState((s) => saveGenericError(s));
        setSaveState("error");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportKind]);

  const saveDocumentNow = useCallback(async () => {
    const editorToken = getEditorToken();
    const documentKey = documentKeyRef.current;
    const masterKey = masterKeyRef.current;
    if (!editorToken || !documentKey || !masterKey) return;

    setState((s) => startSavingDocument(s));
    setSaveState("saving");
    try {
      const snapshot = useConnectedInvoiceStore.getState().exportDocumentSnapshot();
      const encrypted = await encryptDocument(snapshot, documentKey);
      const wrapped = await wrapDocumentKey(documentKey, masterKey);
      const dto = await apiSaveDocument(editorToken, {
        expectedRevision: documentRevisionRef.current,
        vaultProfileVersion: vaultProfileVersionRef.current,
        encryptionKeyVersion: encrypted.encryptionKeyVersion,
        cipherAlgorithm: encrypted.cipherAlgorithm,
        wrappedDocumentKeyBase64: wrapped.wrappedDocumentKeyBase64,
        documentKeyNonceBase64: wrapped.documentKeyNonceBase64,
        documentCiphertextBase64: encrypted.documentCiphertextBase64,
        documentNonceBase64: encrypted.documentNonceBase64,
        documentSha256Base64: encrypted.documentSha256Base64,
      });
      documentRevisionRef.current = dto.revision;
      setState((s) => saveSucceeded(s));
      setSaveState("saved");
    } catch (e) {
      const kind = reportKind(e);
      if (kind === "conflict") {
        setState((s) => saveConflict(s, "document"));
        setSaveState("conflict");
      } else if (kind === "network_error") {
        setState((s) => saveWentOffline(s));
        setSaveState("offline");
      } else if (kind === "unauthorized" || kind === "forbidden") {
        setState((s) => saveSessionExpired(s));
        clearEditorToken();
      } else {
        setState((s) => saveGenericError(s));
        setSaveState("error");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportKind]);

  /** Applies a freshly-fetched WorkPackageDTO everywhere its revision matters — the
   * store (for display) and invoiceRevisionRef (the source of truth for reserve/
   * finalize's expectedRevision, kept distinct from the document's own revision). */
  const applyWorkPackage = useCallback((wp: WorkPackageDTO) => {
    invoiceRevisionRef.current = wp.revision;
    useConnectedInvoiceStore.getState().setWorkPackage(wp);
  }, []);

  const refetchWorkPackage = useCallback(async () => {
    const editorToken = getEditorToken();
    if (!editorToken) return;
    const wp = await getWorkPackage(editorToken);
    applyWorkPackage(wp);
    const anyLineNeedsReview = wp.lines.some((l) => l.requiresReview && !l.isExcluded);
    setState((s) => setRequiresReview(s, wp.requiresReview || anyLineNeedsReview));
    return wp;
  }, [applyWorkPackage]);

  const patchServerItem = useCallback<ConnectedSessionValue["patchServerItem"]>(async (itemId, patch) => {
    const editorToken = getEditorToken();
    if (!editorToken) return;
    try {
      const wp = await apiPatchItem(editorToken, itemId, {
        description: patch.description,
        workType: patch.workType,
        quantity: patch.quantity !== undefined ? String(patch.quantity) : undefined,
        unit: patch.unit,
        unitPrice: patch.unitPrice !== undefined ? String(patch.unitPrice) : undefined,
      });
      applyWorkPackage(wp);
      const anyLineNeedsReview = wp.lines.some((l) => l.requiresReview && !l.isExcluded);
      setState((s) => setRequiresReview(s, wp.requiresReview || anyLineNeedsReview));
    } catch (e) {
      cdbg("useConnectedSession.patchServerItem.failed", { kind: reportKind(e) });
    }
  }, [reportKind, applyWorkPackage]);

  const excludeServerItem = useCallback(async (itemId: string) => {
    const editorToken = getEditorToken();
    if (!editorToken) return;
    try {
      const wp = await apiExcludeItem(editorToken, itemId);
      applyWorkPackage(wp);
    } catch (e) {
      cdbg("useConnectedSession.excludeServerItem.failed", { kind: reportKind(e) });
    }
  }, [reportKind, applyWorkPackage]);

  const includeServerItem = useCallback(async (itemId: string) => {
    const editorToken = getEditorToken();
    if (!editorToken) return;
    try {
      const wp = await apiIncludeItem(editorToken, itemId);
      applyWorkPackage(wp);
    } catch (e) {
      cdbg("useConnectedSession.includeServerItem.failed", { kind: reportKind(e) });
    }
  }, [reportKind, applyWorkPackage]);

  const importVaultFromTemplate = useCallback(() => {
    if (!vaultImportCandidate) return;
    useConnectedInvoiceStore.getState().patchCompany(vaultImportCandidate.companyDraft);
    useConnectedInvoiceStore.getState().patchClient(vaultImportCandidate.profileDraft.client);
    if (vaultImportCandidate.profileDraft.dueDays !== undefined) {
      useConnectedInvoiceStore.getState().setDueDays(vaultImportCandidate.profileDraft.dueDays);
    }
    setVaultImportCandidate(null);
    setHasProfileForBillingRef(true);
  }, [vaultImportCandidate]);

  const dismissVaultImportCandidate = useCallback(() => setVaultImportCandidate(null), []);

  const createNewLocalProfile = useCallback(async () => {
    const profileRef = billingProfileRefRef.current;
    if (!profileRef) return;
    const key = await getOrCreateMasterKey(profileRef);
    masterKeyRef.current = key;
    vaultRef.current = makeEmptyVault();
    setState((s) => ({ ...s, phase: "loaded_editing" }));
    setHasProfileForBillingRef(false);
    skipNextAutosaveRef.current = true;
  }, []);

  const startFinalize = useCallback(async () => {
    const editorToken = getEditorToken();
    if (!editorToken || !workPackage) return;

    setState((s) => startReserve(s));
    await reserveNumberAndContinue(false);
  }, [invoice, workPackage]);

  async function settlePreviewAndRender() {
    await new Promise((resolve) => setTimeout(resolve, PREVIEW_SETTLE_MS));
    setState((s) => previewSettled(s));
    await runRenderThroughFinalize();
  }

  /**
   * Reserves the invoice number and continues into render/upload/finalize.
   * When `checkExisting` is true (only on a retry after `reserve_failed`),
   * re-fetches the work package first and never calls reserveNumber if the
   * invoice already shows a reserved number or is already FINALIZED — the
   * previous attempt's response may simply have been lost in transit, not
   * actually failed server-side.
   */
  async function reserveNumberAndContinue(checkExisting: boolean) {
    const editorToken = getEditorToken();
    if (!editorToken) return;

    let latestWp: WorkPackageDTO | null | undefined = useConnectedInvoiceStore.getState().workPackage;

    if (checkExisting) {
      try {
        latestWp = await refetchWorkPackage();
      } catch (e) {
        cdbg("useConnectedSession.retryReserve.refetch.failed", { kind: reportKind(e) });
      }

      if (latestWp?.status === "FINALIZED") {
        setState((s) => lockAsFinalized(s));
        return;
      }
      if (latestWp?.status === "NUMBER_RESERVED" && latestWp.invoiceNumber) {
        // A previous attempt already reserved this number — never reserve a
        // second one. Adopt the invoice's actual revision and number and
        // continue straight into the render/upload/finalize chain.
        invoiceRevisionRef.current = latestWp.revision;
        storePatchInvoice({ number: latestWp.invoiceNumber });
        setState((s) => reserveAlreadyDone(s));
        await settlePreviewAndRender();
        return;
      }
    }

    let reserveResp;
    try {
      reserveResp = await apiReserveNumber(editorToken, {
        expectedRevision: latestWp?.revision ?? invoiceRevisionRef.current,
        issueDate: invoice.issueDateISO,
        dueDate: computeDueDate(invoice),
      });
    } catch (e) {
      setState((s) => reserveFailed(s));
      return;
    }

    // This is the invoice's own revision (Invoices.revision) — the value the
    // backend's /finalize checks expectedRevision against. It must be threaded
    // through to finalize as-is; a later document-save's revision is a
    // different counter entirely and must never be substituted here.
    invoiceRevisionRef.current = reserveResp.revision;
    storePatchInvoice({ number: reserveResp.invoiceNumber });
    setState((s) => reserveSucceeded(s));

    await settlePreviewAndRender();
  }

  async function runRenderThroughFinalize() {
    let pdfBlob: Blob;
    try {
      const rendered = await renderInvoiceBlob(useConnectedInvoiceStore.getState().invoice, invoiceLang as any);
      pdfBlob = rendered.blob;
    } catch {
      setState((s) => renderFailed(s));
      return;
    }
    setState((s) => renderSucceeded(s));

    const editorToken = getEditorToken();
    const documentKey = documentKeyRef.current;
    const masterKey = masterKeyRef.current;
    if (!editorToken || !documentKey || !masterKey) {
      setState((s) => uploadFailed(s));
      return;
    }

    try {
      const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
      const pdfEncrypted = await encryptPdf(pdfBytes, documentKey);
      const snapshot = useConnectedInvoiceStore.getState().exportDocumentSnapshot();
      const docEncrypted = await encryptDocument(snapshot, documentKey);
      const wrapped = await wrapDocumentKey(documentKey, masterKey);
      const dto = await apiSaveDocument(editorToken, {
        expectedRevision: documentRevisionRef.current,
        vaultProfileVersion: vaultProfileVersionRef.current,
        encryptionKeyVersion: docEncrypted.encryptionKeyVersion,
        cipherAlgorithm: docEncrypted.cipherAlgorithm,
        wrappedDocumentKeyBase64: wrapped.wrappedDocumentKeyBase64,
        documentKeyNonceBase64: wrapped.documentKeyNonceBase64,
        documentCiphertextBase64: docEncrypted.documentCiphertextBase64,
        documentNonceBase64: docEncrypted.documentNonceBase64,
        documentSha256Base64: docEncrypted.documentSha256Base64,
        pdfCiphertextBase64: pdfEncrypted.pdfCiphertextBase64,
        pdfNonceBase64: pdfEncrypted.pdfNonceBase64,
        pdfSha256Base64: pdfEncrypted.pdfSha256Base64,
        pdfSizeBytes: pdfEncrypted.pdfSizeBytes,
      });
      // This is EncryptedInvoiceDocuments.revision — a separate counter from
      // the invoice's own revision. It belongs only in the *next* saveDocument
      // call's expectedRevision, never in /finalize's (see invoiceRevisionRef).
      documentRevisionRef.current = dto.revision;
      setFinalPdfBlob(pdfBlob);
    } catch {
      setState((s) => uploadFailed(s));
      return;
    }
    setState((s) => uploadSucceeded(s));

    const wp = useConnectedInvoiceStore.getState().workPackage;
    const activeAmounts = (wp?.lines ?? []).filter((l) => !l.isExcluded);
    const currentInvoice = useConnectedInvoiceStore.getState().invoice;
    const manualLines = useConnectedInvoiceStore.getState().manualLines;
    const finalNet = sumDecimalStrings([
      ...activeAmounts.map((l) => l.netAmount),
      ...manualLines.map((m) => String(m.item.qty * m.item.unitPrice)),
    ]);
    const manualVat = manualLines.reduce((sum, m) => sum + m.item.qty * m.item.unitPrice * (m.item.vatRate / 100), 0);
    const finalVat = sumDecimalStrings([...activeAmounts.map((l) => l.vatAmount), manualVat.toFixed(2)]);
    const finalGross = sumDecimalStrings([finalNet, finalVat]);

    try {
      await apiFinalizeInvoice(editorToken, {
        expectedRevision: invoiceRevisionRef.current,
        finalNetAmount: finalNet,
        finalVatAmount: finalVat,
        finalGrossAmount: finalGross,
      });
    } catch {
      setState((s) => finalizeFailed(s));
      return;
    }
    setState((s) => finalizeSucceeded(s));

    if (invoiceIdRef.current) {
      try {
        const wrapped = await wrapDocumentKey(documentKeyRef.current!, masterKeyRef.current!);
        const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
        const pdfEncrypted = await encryptPdf(pdfBytes, documentKeyRef.current!);
        const snapshot = useConnectedInvoiceStore.getState().exportDocumentSnapshot();
        const docEncrypted = await encryptDocument(snapshot, documentKeyRef.current!);
        await saveFinalizedDocument({
          invoiceId: invoiceIdRef.current,
          documentCiphertextBase64: docEncrypted.documentCiphertextBase64,
          documentNonceBase64: docEncrypted.documentNonceBase64,
          documentSha256Base64: docEncrypted.documentSha256Base64,
          wrappedDocumentKeyBase64: wrapped.wrappedDocumentKeyBase64,
          documentKeyNonceBase64: wrapped.documentKeyNonceBase64,
          vaultProfileVersion: vaultProfileVersionRef.current,
          encryptionKeyVersion: docEncrypted.encryptionKeyVersion,
          pdfCiphertextBase64: pdfEncrypted.pdfCiphertextBase64,
          pdfNonceBase64: pdfEncrypted.pdfNonceBase64,
          pdfSha256Base64: pdfEncrypted.pdfSha256Base64,
          savedAt: new Date().toISOString(),
        });
      } catch (e) {
        cdbg("useConnectedSession.persistFinalizedCopy.failed", {});
      }
    }
  }

  const retryAfterFailure = useCallback(async () => {
    if (state.phase === "reserve_failed") {
      // Never blindly re-call reserveNumber: the previous attempt's response
      // may have been lost after the server already committed it. Always
      // re-check the invoice's actual status first (see reserveNumberAndContinue).
      setState((s) => retryReserve(s));
      await reserveNumberAndContinue(true);
      return;
    }
    if (state.phase === "render_failed") {
      setState((s) => retryRender(s));
      await runRenderThroughFinalize();
      return;
    }
    if (state.phase === "upload_failed") {
      setState((s) => retryUpload(s));
      await runRenderThroughFinalize();
      return;
    }
    if (state.phase === "finalize_failed") {
      setState((s) => retryFinalize(s));
      // Re-check status before calling finalize again — if a previous call actually
      // succeeded server-side but the response was lost, treat it as done instead
      // of finalizing twice.
      const wp = await refetchWorkPackage();
      if (wp?.status === "FINALIZED") {
        setState((s) => finalizeSucceeded(s));
        return;
      }
      await runRenderThroughFinalize();
      return;
    }
    if (state.phase === "conflict" || state.phase === "offline") {
      setState((s) => resumeEditing(s));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  const downloadFinalPdf = useCallback(() => {
    if (!finalPdfBlob) return;
    const url = URL.createObjectURL(finalPdfBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${invoice.number || "invoice"}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [finalPdfBlob, invoice.number]);

  const reconnect = useCallback(async (invoiceId: string, shortCode: string) => {
    setState((s) => startExchange(s));
    try {
      const resp = await exchangeToken({ invoiceId, shortCode });
      setEditorSession({
        editorAccessToken: resp.editorAccessToken,
        accessExpiresAt: resp.accessExpiresAt,
        permissions: resp.permissions,
      });
      setAccessExpiresAt(resp.accessExpiresAt);
      invoiceIdRef.current = resp.invoiceId;
      setState((s) => exchangeSucceeded(s, resp.permissions));
      setLoading(true);
      const editorToken = getEditorToken();
      if (editorToken) {
        const wp = await getWorkPackage(editorToken);
        invoiceRevisionRef.current = wp.revision;
        useConnectedInvoiceStore.getState().setWorkPackage(wp);
        billingProfileRefRef.current = wp.billingProfileRef;
      }
      setLoading(false);
    } catch (e) {
      setState((s) => exchangeFailed(s, reportKind(e)));
    }
  }, [reportKind]);

  const openReconnect = useCallback(() => setState((s) => openReconnectScreen(s)), []);

  return {
    state,
    loading,
    workPackage,
    saveState,
    accessExpiresAt,
    finalPdfBlob,
    vaultImportCandidate,
    billingProfileRef: billingProfileRefRef.current,
    hasProfileForBillingRef,
    editor: {
      invoice,
      invoiceLang,
      setInvoiceLang: storeSetInvoiceLang,
      setCurrency: storeSetCurrency,
      setDueDays: storeSetDueDays,
      patchCompany: storePatchCompany,
      patchClient: storePatchClient,
      patchInvoice: storePatchInvoice,
    },
    reconnect,
    openReconnect,
    patchServerItem,
    excludeServerItem,
    includeServerItem,
    addManualLine: useConnectedInvoiceStore.getState().addManualLine,
    updateManualLine: useConnectedInvoiceStore.getState().updateManualLine,
    removeManualLine: useConnectedInvoiceStore.getState().removeManualLine,
    importVaultFromTemplate,
    dismissVaultImportCandidate,
    createNewLocalProfile,
    startFinalize,
    retryAfterFailure,
    downloadFinalPdf,
  };
}

function computeDueDate(invoice: InvoiceData): string {
  if (!invoice.issueDateISO || invoice.dueDays === undefined) return invoice.issueDateISO || "";
  const issue = new Date(`${invoice.issueDateISO}T00:00:00Z`);
  if (Number.isNaN(issue.getTime())) return invoice.issueDateISO;
  issue.setUTCDate(issue.getUTCDate() + invoice.dueDays);
  return issue.toISOString().slice(0, 10);
}

export { getFinalizedDocument, decryptPdf };
