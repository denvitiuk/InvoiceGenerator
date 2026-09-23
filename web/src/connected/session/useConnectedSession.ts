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
  overrideNumber as apiOverrideNumber,
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
import { invoicePdfFileName } from "@/lib/safeFileName";
import {
  computeFinalAmounts,
  finalizeBlockers,
  IMMUTABLE_NUMBER_STATUSES,
  isNumberEditable,
  type FinalizeBlocker,
} from "../finalize/finalizeChecks";
import { activeItems } from "../mapping/workPackageDecoder";
import { useConnectedInvoiceStore } from "../store/connectedInvoiceStore";
import type { ApiErrorKind, EditorPermissions, SessionMachineState } from "./sessionMachine";
import {
  canStartReserve,
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
import type { ReserveInvoiceNumberResponse, WorkPackageDTO } from "../types";

const AUTOSAVE_DEBOUNCE_MS = 1200;

/** Backend rule for manual numbers (InvoiceNumberingService.validateManualNumber). */
const MANUAL_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,63}$/;
const PREVIEW_SETTLE_MS = 400; // strictly longer than PreviewPane's debounceMs=250

export type SaveState = "idle" | "saving" | "saved" | "offline" | "conflict" | "error";

/** Why the last reserve/render/upload/finalize step failed — shown without closing the dialog. */
export interface FlowError {
  kind: ApiErrorKind | "number_missing" | "blocked";
  /** The backend's own error message (never tokens/PII), when it sent one. */
  serverMessage?: string;
  blockers?: FinalizeBlocker[];
}

export type OverrideNumberResult =
  | { ok: true; invoiceNumber: string; revision: number }
  | {
      ok: false;
      reason: "busy" | "no_permission" | "immutable" | "invalid_format" | "conflict" | "session_expired" | "failed";
      serverMessage?: string;
    };

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
  /** Field-level detail for an invalid_contract load error (field names only). */
  loadErrorDetail: string | null;
  flowError: FlowError | null;
  /** Everything that currently prevents confirming the invoice (empty = ready). */
  finalizeBlockers: FinalizeBlocker[];
  overrideInFlight: boolean;

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
  /** Starts a recipient profile for this billingProfileRef (prefilled with the backend's customer name). */
  createRecipientProfile: () => Promise<void>;
  overrideInvoiceNumber: (invoiceNumber: string) => Promise<OverrideNumberResult>;
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
  const [loadErrorDetail, setLoadErrorDetail] = useState<string | null>(null);
  const [flowError, setFlowError] = useState<FlowError | null>(null);
  const [overrideInFlight, setOverrideInFlight] = useState(false);
  const manualLines = useConnectedInvoiceStore((s) => s.manualLines);

  const invoice = useConnectedInvoiceStore((s) => s.invoice);
  const invoiceLang = useConnectedInvoiceStore((s) => s.invoiceLang);
  const workPackage = useConnectedInvoiceStore((s) => s.workPackage);
  const storeSetInvoiceLang = useConnectedInvoiceStore((s) => s.setInvoiceLang);
  const storeSetCurrency = useConnectedInvoiceStore((s) => s.setCurrency);
  const storeSetDueDays = useConnectedInvoiceStore((s) => s.setDueDays);
  const storePatchCompany = useConnectedInvoiceStore((s) => s.patchCompany);
  const storePatchClient = useConnectedInvoiceStore((s) => s.patchClient);
  const storePatchInvoice = useConnectedInvoiceStore((s) => s.patchInvoice);

  // The machine's source of truth. Every transition goes through transition()
  // below, which applies it to this ref synchronously and then mirrors it into
  // React state — so two async callbacks firing in the same tick (e.g. the vault
  // and document autosave timers) see each other's transitions, and an illegal
  // transition throws in the caller instead of inside a React state updater
  // (which would take the whole page down).
  const stateRef = useRef(state);
  const transition = useCallback((fn: (s: SessionMachineState) => SessionMachineState) => {
    const next = fn(stateRef.current);
    stateRef.current = next;
    setState(next);
  }, []);
  // Vault and document saves share one lock on the backend-facing session
  // phase, so they run strictly one after another.
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const enqueueSave = useCallback((run: () => Promise<void>): Promise<void> => {
    const next = saveChainRef.current.then(run, run);
    saveChainRef.current = next.catch(() => {});
    return next;
  }, []);
  // Synchronous re-entrancy guards: a double click must never start a second
  // finalize flow or a second number override.
  const finalizeInFlightRef = useRef(false);
  const overrideInFlightRef = useRef(false);

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

  const reportKind = useCallback((e: unknown): ApiErrorKind => {
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
          transition((s) => markUnsupportedBrowser(s));
          setLoading(false);
        }
        return;
      }

      if (token) {
        transition((s) => startExchange(s));
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
            transition((s) => exchangeFailed(s, reportKind(e)));
            setLoading(false);
          }
          return;
        }

        transition((s) => exchangeSucceeded(s, permissions));
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
        transition((s) => sessionExpiredOnRestore(s));
        setLoading(false);
        return;
      }

      setAccessExpiresAt(stored.accessExpiresAt);
      // Permissions come from exactly what was issued at the original
      // exchange — never assumed/defaulted while restoring.
      transition((s) => restoreSession(s, stored.permissions));
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
        if (kind === "invalid_contract" && e instanceof EditorApiError) setLoadErrorDetail(e.serverMessage ?? null);
        transition((s) => loadFailed(s, kind));
        return;
      }
      if (cancelled) return;

      invoiceIdRef.current = wp.invoiceId;
      invoiceRevisionRef.current = wp.revision;
      useConnectedInvoiceStore.getState().setWorkPackage(wp);
      billingProfileRefRef.current = wp.billingProfileRef;
      const anyLineNeedsReview = wp.items.some((l) => l.requiresReview && !l.isExcluded);
      transition((s) => setRequiresReview(s, wp.requiresReview || anyLineNeedsReview));

      if (IMMUTABLE_NUMBER_STATUSES.has(wp.status)) {
        transition((s) => lockAsFinalized(s));
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
            transition((s) => markVaultUnavailable(s));
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
          transition((s) => loadFailed(s, kind));
          return;
        }
        vaultRef.current = makeEmptyVault();
        masterKeyRef.current = masterKey;
      }

      // Only ever the profile of THIS invoice's billingProfileRef — never
      // another customer's. Without one, the recipient stays empty and the
      // banner offers to create or import it (finalizing stays blocked).
      const profile = vaultRef.current.profiles[wp.billingProfileRef];
      setHasProfileForBillingRef(Boolean(profile));
      if (profile) {
        useConnectedInvoiceStore.getState().applyVaultProfile(profile, vaultRef.current.company, true);
      } else {
        if (remoteVaultExists) useConnectedInvoiceStore.getState().patchCompany(vaultRef.current.company);
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
          transition((s) => loadFailed(s, kind));
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

  const saveVaultNow = useCallback(() => enqueueSave(saveVaultInner), [enqueueSave]);
  const saveDocumentNow = useCallback(() => enqueueSave(saveDocumentInner), [enqueueSave]);

  async function saveVaultInner() {
    const editorToken = getEditorToken();
    const profileRef = billingProfileRefRef.current;
    const masterKey = masterKeyRef.current;
    if (!editorToken || !profileRef || !masterKey) return;
    if (stateRef.current.phase !== "loaded_editing") return;

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

    transition((s) => startSavingVault(s));
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
      transition((s) => saveSucceeded(s));
      setSaveState("saved");
    } catch (e) {
      const kind = reportKind(e);
      if (kind === "conflict") {
        transition((s) => saveConflict(s, "vault"));
        setSaveState("conflict");
      } else if (kind === "network_error") {
        transition((s) => saveWentOffline(s));
        setSaveState("offline");
      } else if (kind === "unauthorized" || kind === "forbidden") {
        transition((s) => saveSessionExpired(s));
        clearEditorToken();
      } else {
        transition((s) => saveGenericError(s));
        setSaveState("error");
      }
    }
  }

  async function saveDocumentInner() {
    const editorToken = getEditorToken();
    const documentKey = documentKeyRef.current;
    const masterKey = masterKeyRef.current;
    if (!editorToken || !documentKey || !masterKey) return;
    if (stateRef.current.phase !== "loaded_editing") return;

    transition((s) => startSavingDocument(s));
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
      transition((s) => saveSucceeded(s));
      setSaveState("saved");
    } catch (e) {
      const kind = reportKind(e);
      if (kind === "conflict") {
        transition((s) => saveConflict(s, "document"));
        setSaveState("conflict");
      } else if (kind === "network_error") {
        transition((s) => saveWentOffline(s));
        setSaveState("offline");
      } else if (kind === "unauthorized" || kind === "forbidden") {
        transition((s) => saveSessionExpired(s));
        clearEditorToken();
      } else {
        transition((s) => saveGenericError(s));
        setSaveState("error");
      }
    }
  }

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
    const anyLineNeedsReview = wp.items.some((l) => l.requiresReview && !l.isExcluded);
    transition((s) => setRequiresReview(s, wp.requiresReview || anyLineNeedsReview));
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
      const anyLineNeedsReview = wp.items.some((l) => l.requiresReview && !l.isExcluded);
      transition((s) => setRequiresReview(s, wp.requiresReview || anyLineNeedsReview));
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
    transition((s) => ({ ...s, phase: "loaded_editing" }));
    setHasProfileForBillingRef(false);
    skipNextAutosaveRef.current = true;
  }, []);

  const createRecipientProfile = useCallback(async () => {
    const store = useConnectedInvoiceStore.getState();
    const displayName = store.workPackage?.customer?.displayName?.trim();
    if (!(store.invoice.client.name || "").trim() && displayName) {
      store.patchClient({ name: displayName });
    }
    setVaultImportCandidate(null);
    await saveVaultNow();
  }, [saveVaultNow]);

  const currentBlockers = useCallback((): FinalizeBlocker[] => {
    const store = useConnectedInvoiceStore.getState();
    return finalizeBlockers({
      workPackage: store.workPackage,
      invoice: store.invoice,
      manualLines: store.manualLines,
      canFinalize: stateRef.current.context.permissions.finalize,
      requiresReview: stateRef.current.context.requiresReview,
      hasProfileForBillingRef,
    });
  }, [hasProfileForBillingRef]);

  const startFinalize = useCallback(async () => {
    if (finalizeInFlightRef.current) return;
    const editorToken = getEditorToken();
    if (!editorToken || !useConnectedInvoiceStore.getState().workPackage) return;

    const blockers = currentBlockers();
    if (blockers.length) {
      setFlowError({ kind: "blocked", blockers });
      return;
    }
    if (!canStartReserve(stateRef.current)) return;

    finalizeInFlightRef.current = true;
    try {
      setFlowError(null);
      transition((s) => startReserve(s));
      await reserveNumberAndContinue(false);
    } finally {
      finalizeInFlightRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBlockers]);

  async function settlePreviewAndRender() {
    await new Promise((resolve) => setTimeout(resolve, PREVIEW_SETTLE_MS));
    transition((s) => previewSettled(s));
    await runRenderThroughFinalize();
  }

  /**
   * Reserves the invoice number and continues into render/upload/finalize.
   * The number always comes from the backend: either it is already stored on
   * the invoice (an earlier reservation or a manual override), or
   * number:reserve returns it. When `checkExisting` is true (a retry after
   * `reserve_failed`), the work package is re-read first and a failed re-read
   * stops the retry — the previous attempt's response may have been lost
   * after the server already committed it, so we never reserve blindly.
   */
  async function reserveNumberAndContinue(checkExisting: boolean) {
    const editorToken = getEditorToken();
    if (!editorToken) return;

    let latestWp: WorkPackageDTO | null | undefined = useConnectedInvoiceStore.getState().workPackage;

    if (checkExisting) {
      try {
        latestWp = await refetchWorkPackage();
      } catch (e) {
        const kind = reportKind(e);
        cdbg("useConnectedSession.retryReserve.refetch.failed", { kind });
        setFlowError({ kind, serverMessage: e instanceof EditorApiError ? e.serverMessage : undefined });
        transition((s) => reserveFailed(s));
        return;
      }
    }
    if (!latestWp) {
      transition((s) => reserveFailed(s));
      return;
    }

    if (IMMUTABLE_NUMBER_STATUSES.has(latestWp.status)) {
      transition((s) => lockAsFinalized(s));
      return;
    }
    if (latestWp.status === "NUMBER_RESERVED" && latestWp.invoiceNumber) {
      // Already reserved (earlier attempt or manual override) — never reserve a
      // second number. Re-apply the backend's number/dates to the invoice and
      // continue straight into the render/upload/finalize chain.
      invoiceRevisionRef.current = latestWp.revision;
      useConnectedInvoiceStore.getState().setWorkPackage(latestWp);
      transition((s) => reserveAlreadyDone(s));
      await settlePreviewAndRender();
      return;
    }

    let reserveResp: ReserveInvoiceNumberResponse;
    try {
      reserveResp = await apiReserveNumber(editorToken, {
        expectedRevision: latestWp.revision,
        ...requestDates(useConnectedInvoiceStore.getState().invoice),
      });
    } catch (e) {
      const kind = reportKind(e);
      cdbg("useConnectedSession.reserve.failed", { kind });
      setFlowError({ kind, serverMessage: e instanceof EditorApiError ? e.serverMessage : undefined });
      transition((s) => reserveFailed(s));
      if (kind === "conflict") {
        // Show the invoice as it is now; the retry re-checks before reserving.
        try {
          await refetchWorkPackage();
        } catch {
          // the retry path re-reads again anyway
        }
      }
      return;
    }

    // This is the invoice's own revision (Invoices.revision) — the value the
    // backend's /finalize checks expectedRevision against. It must be threaded
    // through to finalize as-is; a later document-save's revision is a
    // different counter entirely and must never be substituted here.
    invoiceRevisionRef.current = reserveResp.revision;
    useConnectedInvoiceStore.getState().applyNumberResult(reserveResp);
    transition((s) => reserveSucceeded(s));

    await settlePreviewAndRender();
  }

  async function runRenderThroughFinalize() {
    // Hard guard: the final PDF is only ever rendered with the number the
    // backend actually stored — never an empty, stale or local one.
    const beforeRender = useConnectedInvoiceStore.getState();
    const reservedNumber = beforeRender.workPackage?.invoiceNumber;
    if (!reservedNumber || beforeRender.invoice.number !== reservedNumber) {
      cdbg("useConnectedSession.render.blocked_without_reserved_number", {});
      setFlowError({ kind: "number_missing" });
      transition((s) => renderFailed(s));
      return;
    }

    let pdfBlob: Blob;
    try {
      const rendered = await renderInvoiceBlob(beforeRender.invoice, invoiceLang as any);
      pdfBlob = rendered.blob;
    } catch {
      setFlowError({ kind: "server_error" });
      transition((s) => renderFailed(s));
      return;
    }
    transition((s) => renderSucceeded(s));

    const editorToken = getEditorToken();
    const documentKey = documentKeyRef.current;
    const masterKey = masterKeyRef.current;
    if (!editorToken || !documentKey || !masterKey) {
      setFlowError({ kind: "unauthorized" });
      transition((s) => uploadFailed(s));
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
    } catch (e) {
      setFlowError({ kind: reportKind(e), serverMessage: e instanceof EditorApiError ? e.serverMessage : undefined });
      transition((s) => uploadFailed(s));
      return;
    }
    transition((s) => uploadSucceeded(s));

    const wp = useConnectedInvoiceStore.getState().workPackage;
    if (!wp) {
      transition((s) => finalizeFailed(s));
      return;
    }
    // Backend totals for every server line + locally computed manual rows —
    // exactly the amounts the PDF shows (same invoiceTax rules).
    const amounts = computeFinalAmounts(wp, useConnectedInvoiceStore.getState().manualLines);

    let finalizeResp;
    try {
      finalizeResp = await apiFinalizeInvoice(editorToken, {
        expectedRevision: invoiceRevisionRef.current,
        ...amounts,
      });
    } catch (e) {
      setFlowError({ kind: reportKind(e), serverMessage: e instanceof EditorApiError ? e.serverMessage : undefined });
      transition((s) => finalizeFailed(s));
      return;
    }
    invoiceRevisionRef.current = finalizeResp.revision;
    const latest = useConnectedInvoiceStore.getState().workPackage;
    if (latest) {
      useConnectedInvoiceStore.getState().setWorkPackage({ ...latest, status: "FINALIZED", revision: finalizeResp.revision });
    }
    setFlowError(null);
    transition((s) => finalizeSucceeded(s));

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
    if (finalizeInFlightRef.current) return;
    finalizeInFlightRef.current = true;
    try {
      await retryAfterFailureInner();
    } finally {
      finalizeInFlightRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  async function retryAfterFailureInner() {
    const phase = stateRef.current.phase;
    if (phase === "reserve_failed") {
      // Never blindly re-call reserveNumber: the previous attempt's response
      // may have been lost after the server already committed it. Always
      // re-check the invoice's actual status first (see reserveNumberAndContinue).
      setFlowError(null);
      transition((s) => retryReserve(s));
      await reserveNumberAndContinue(true);
      return;
    }
    if (phase === "render_failed") {
      setFlowError(null);
      transition((s) => retryRender(s));
      await runRenderThroughFinalize();
      return;
    }
    if (phase === "upload_failed") {
      setFlowError(null);
      transition((s) => retryUpload(s));
      await runRenderThroughFinalize();
      return;
    }
    if (phase === "finalize_failed") {
      setFlowError(null);
      transition((s) => retryFinalize(s));
      // Re-check status before calling finalize again — if a previous call actually
      // succeeded server-side but the response was lost, treat it as done instead
      // of finalizing twice.
      let wp: WorkPackageDTO | undefined;
      try {
        wp = await refetchWorkPackage();
      } catch (e) {
        setFlowError({ kind: reportKind(e), serverMessage: e instanceof EditorApiError ? e.serverMessage : undefined });
        transition((s) => finalizeFailed(s));
        return;
      }
      if (wp?.status === "FINALIZED") {
        transition((s) => finalizeSucceeded(s));
        return;
      }
      await runRenderThroughFinalize();
      return;
    }
    if (phase === "conflict" || phase === "offline") {
      transition((s) => resumeEditing(s));
    }
  }

  const overrideInvoiceNumber = useCallback(async (rawNumber: string): Promise<OverrideNumberResult> => {
    if (overrideInFlightRef.current || finalizeInFlightRef.current) return { ok: false, reason: "busy" };
    const editorToken = getEditorToken();
    const wp = useConnectedInvoiceStore.getState().workPackage;
    if (!editorToken || !wp) return { ok: false, reason: "session_expired" };
    if (!stateRef.current.context.permissions.finalize) return { ok: false, reason: "no_permission" };
    if (!isNumberEditable(wp.status)) return { ok: false, reason: "immutable" };
    if (stateRef.current.phase !== "loaded_editing") return { ok: false, reason: "busy" };

    const invoiceNumber = rawNumber.trim();
    if (!MANUAL_NUMBER_RE.test(invoiceNumber)) return { ok: false, reason: "invalid_format" };

    overrideInFlightRef.current = true;
    setOverrideInFlight(true);
    try {
      const resp = await apiOverrideNumber(editorToken, {
        expectedRevision: wp.revision,
        invoiceNumber,
        ...requestDates(useConnectedInvoiceStore.getState().invoice),
      });
      invoiceRevisionRef.current = resp.revision;
      useConnectedInvoiceStore.getState().applyNumberResult(resp);
      return { ok: true, invoiceNumber: resp.invoiceNumber, revision: resp.revision };
    } catch (e) {
      const kind = reportKind(e);
      const serverMessage = e instanceof EditorApiError ? e.serverMessage : undefined;
      cdbg("useConnectedSession.overrideNumber.failed", { kind });
      if (kind === "conflict") {
        // Duplicate number or stale revision: show the invoice as it is now.
        try {
          await refetchWorkPackage();
        } catch {
          // keep the conflict result; the next attempt re-reads again
        }
        return { ok: false, reason: "conflict", serverMessage };
      }
      if (kind === "unauthorized") return { ok: false, reason: "session_expired", serverMessage };
      if (kind === "forbidden") return { ok: false, reason: "no_permission", serverMessage };
      return { ok: false, reason: "failed", serverMessage };
    } finally {
      overrideInFlightRef.current = false;
      setOverrideInFlight(false);
    }
  }, [reportKind, refetchWorkPackage]);

  const downloadFinalPdf = useCallback(() => {
    if (!finalPdfBlob) return;
    const url = URL.createObjectURL(finalPdfBlob);
    const a = document.createElement("a");
    a.href = url;
    // Safe file name only — the number inside the PDF is untouched.
    a.download = invoicePdfFileName(invoice.number);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [finalPdfBlob, invoice.number]);

  const reconnect = useCallback(async (invoiceId: string, shortCode: string) => {
    transition((s) => startExchange(s));
    try {
      const resp = await exchangeToken({ invoiceId, shortCode });
      setEditorSession({
        editorAccessToken: resp.editorAccessToken,
        accessExpiresAt: resp.accessExpiresAt,
        permissions: resp.permissions,
      });
      setAccessExpiresAt(resp.accessExpiresAt);
      invoiceIdRef.current = resp.invoiceId;
      transition((s) => exchangeSucceeded(s, resp.permissions));
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
      transition((s) => exchangeFailed(s, reportKind(e)));
    }
  }, [reportKind]);

  const openReconnect = useCallback(() => transition((s) => openReconnectScreen(s)), []);

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
    loadErrorDetail,
    flowError,
    finalizeBlockers: finalizeBlockers({
      workPackage,
      invoice,
      manualLines,
      canFinalize: state.context.permissions.finalize,
      requiresReview: state.context.requiresReview,
      hasProfileForBillingRef,
    }),
    overrideInFlight,
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
    createRecipientProfile,
    overrideInvoiceNumber,
    startFinalize,
    retryAfterFailure,
    downloadFinalPdf,
  };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function computeDueDate(invoice: InvoiceData): string | undefined {
  if (!ISO_DATE_RE.test(invoice.issueDateISO || "") || invoice.dueDays === undefined) return undefined;
  const issue = new Date(`${invoice.issueDateISO}T00:00:00Z`);
  if (Number.isNaN(issue.getTime())) return undefined;
  issue.setUTCDate(issue.getUTCDate() + invoice.dueDays);
  return issue.toISOString().slice(0, 10);
}

/**
 * issueDate/dueDate for number:reserve / number:override — only sent when they
 * are valid ISO dates; otherwise omitted so the backend applies its own
 * defaults (today in the invoice timezone, + payment terms).
 */
function requestDates(invoice: InvoiceData): { issueDate?: string; dueDate?: string } {
  const issueDate = ISO_DATE_RE.test(invoice.issueDateISO || "") ? invoice.issueDateISO : undefined;
  const dueDate = issueDate ? computeDueDate(invoice) : undefined;
  return { ...(issueDate ? { issueDate } : {}), ...(dueDate ? { dueDate } : {}) };
}

export { getFinalizedDocument, decryptPdf };
