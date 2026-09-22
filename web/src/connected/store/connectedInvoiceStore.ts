// Separate, memory-only Zustand store for connected-invoice mode — deliberately
// NOT the standalone `useStore` from `src/lib/store.ts` and NOT wrapped in
// `persist` middleware, so a connected session can never read from or write to
// the standalone draft (`invoice.store` in localStorage) or the plaintext
// template mechanism.
//
// Exposes the same method names AppShell already calls on the standalone store
// (patchInvoice, patchCompany, patchClient, setInvoiceLang, setCurrency,
// setDueDays) so the two are interchangeable behind a common adapter shape,
// plus connected-only actions for server/manual line management used by
// ConnectedItemsSection.

import { create } from "zustand";
import { makeEmptyInvoice } from "@/lib/store";
import type { ClientInfo, CompanyInfo, Currency, InvoiceData, LineItem } from "@/types/invoice";
import type { UILang } from "@/lib/i18n";
import type { EncryptedDocumentPlaintext, ManualLineRecord } from "../document/documentTypes";
import {
  keyForManualLine,
  keyForServerLine,
  lineDtoToDisplayItem,
  mapWorkPackageToInvoiceData,
  reconcileOrder,
} from "../mapping/workPackageMapping";
import type { InvoiceVaultProfile } from "../vault/vaultTypes";
import type { WorkPackageDTO } from "../types";

type Lang = UILang;

type InvoiceHeader = Omit<InvoiceData, "items">;

function computeItems(
  workPackage: WorkPackageDTO | null,
  manualLines: ManualLineRecord[],
  order: string[],
  lang: Lang
): LineItem[] {
  const activeServerById = new Map(
    (workPackage?.lines ?? [])
      .filter((l) => !l.isExcluded)
      .map((l) => [keyForServerLine(l.invoiceWorkItemId), l] as const)
  );
  const manualByKey = new Map(manualLines.map((m) => [keyForManualLine(m.localId), m.item] as const));

  const items: LineItem[] = [];
  for (const key of order) {
    if (key.startsWith("srv:")) {
      const line = activeServerById.get(key);
      if (line) items.push(lineDtoToDisplayItem(line, lang));
    } else {
      const item = manualByKey.get(key);
      if (item) items.push(item);
    }
  }
  return items;
}

/**
 * Merges work-package-derived fields into the header. currency/servicePeriod/
 * object/number are always backend-authoritative and safe to re-sync on every
 * fetch. issueDateISO/dueDays are only synced on the very first load, or once
 * the backend actually reports a value — otherwise a mid-session admin edit
 * (made before the number is reserved) would get silently clobbered by a
 * background refresh that still reflects the old, unset value.
 */
function mergeHeaderFromWorkPackage(prev: InvoiceHeader, wp: WorkPackageDTO, isFirstLoad: boolean): InvoiceHeader {
  const mapped = mapWorkPackageToInvoiceData(wp);
  const next: InvoiceHeader = {
    ...prev,
    currency: (mapped.currency as Currency) ?? prev.currency,
    servicePeriod: mapped.servicePeriod ?? prev.servicePeriod,
    object: mapped.object ?? prev.object,
    number: mapped.number ?? prev.number,
  };
  if (isFirstLoad || wp.issueDate) next.issueDateISO = mapped.issueDateISO ?? prev.issueDateISO;
  if (isFirstLoad || (wp.issueDate && wp.dueDate)) next.dueDays = mapped.dueDays ?? prev.dueDays;
  return next;
}

export interface ConnectedInvoiceState {
  invoiceLang: Lang;
  invoice: InvoiceData;
  workPackage: WorkPackageDTO | null;
  manualLines: ManualLineRecord[];
  order: string[];

  // --- Generic adapter surface (same shape as the standalone store) ------
  setInvoiceLang: (lang: Lang) => void;
  setCurrency: (cur: Currency) => void;
  setDueDays: (days: number) => void;
  patchCompany: (patch: Partial<CompanyInfo>) => void;
  patchClient: (patch: Partial<ClientInfo>) => void;
  patchInvoice: (patch: Partial<InvoiceData>) => void;

  // --- Connected-only actions ---------------------------------------------
  setWorkPackage: (wp: WorkPackageDTO) => void;
  applyVaultProfile: (profile: InvoiceVaultProfile, company: CompanyInfo, seedDefaultItems: boolean) => void;
  addManualLine: (item: LineItem) => string;
  updateManualLine: (localId: string, patch: Partial<LineItem>) => void;
  removeManualLine: (localId: string) => void;
  reorderItems: (newOrder: string[]) => void;
  loadDocumentSnapshot: (doc: EncryptedDocumentPlaintext) => void;
  exportDocumentSnapshot: () => EncryptedDocumentPlaintext;
  reset: () => void;
}

function safeLocalId(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `manual_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function recompute(header: InvoiceHeader, workPackage: WorkPackageDTO | null, manualLines: ManualLineRecord[], order: string[], lang: Lang): InvoiceData {
  return makeEmptyInvoice({
    ...header,
    language: lang,
    items: computeItems(workPackage, manualLines, order, lang),
  });
}

export const useConnectedInvoiceStore = create<ConnectedInvoiceState>()((set, get) => ({
  invoiceLang: "de",
  invoice: makeEmptyInvoice({ language: "de" }),
  workPackage: null,
  manualLines: [],
  order: [],

  setInvoiceLang: (lang) =>
    set((s) => {
      const header: InvoiceHeader = { ...s.invoice, language: lang };
      return { invoiceLang: lang, invoice: recompute(header, s.workPackage, s.manualLines, s.order, lang) };
    }),

  setCurrency: (cur) =>
    set((s) => ({ invoice: { ...s.invoice, currency: cur } })),

  setDueDays: (days) =>
    set((s) => ({ invoice: { ...s.invoice, dueDays: Math.max(0, Math.floor(days)) } })),

  patchCompany: (patch) =>
    set((s) => ({ invoice: { ...s.invoice, company: { ...s.invoice.company, ...patch } } })),

  patchClient: (patch) =>
    set((s) => ({ invoice: { ...s.invoice, client: { ...s.invoice.client, ...patch } } })),

  patchInvoice: (patch) =>
    set((s) => ({ invoice: { ...s.invoice, ...patch } })),

  setWorkPackage: (wp) =>
    set((s) => {
      const isFirstLoad = s.workPackage === null;
      const manualKeys = s.manualLines.map((m) => keyForManualLine(m.localId));
      const activeLines = wp.lines.filter((l) => !l.isExcluded);
      const nextOrder = reconcileOrder(s.order, activeLines, manualKeys);
      const header = mergeHeaderFromWorkPackage(s.invoice, wp, isFirstLoad);
      return {
        workPackage: wp,
        order: nextOrder,
        invoice: recompute(header, wp, s.manualLines, nextOrder, s.invoiceLang),
      };
    }),

  applyVaultProfile: (profile, company, seedDefaultItems) =>
    set((s) => {
      const header: InvoiceHeader = {
        ...s.invoice,
        company,
        client: profile.client,
        dueDays: s.invoice.dueDays ?? profile.dueDays,
        theme: s.invoice.theme ?? profile.theme,
        notes: s.invoice.notes?.length ? s.invoice.notes : profile.notes ?? s.invoice.notes,
      };

      let manualLines = s.manualLines;
      let order = s.order;
      if (seedDefaultItems && manualLines.length === 0 && Array.isArray(profile.defaultItems) && profile.defaultItems.length) {
        const seeded = profile.defaultItems.map((item) => ({ localId: safeLocalId(), item: { ...item } }));
        manualLines = seeded;
        order = [...order, ...seeded.map((m) => keyForManualLine(m.localId))];
      }

      return {
        manualLines,
        order,
        invoice: recompute(header, s.workPackage, manualLines, order, s.invoiceLang),
      };
    }),

  addManualLine: (item) => {
    const localId = safeLocalId();
    set((s) => {
      const manualLines = [...s.manualLines, { localId, item }];
      const order = [...s.order, keyForManualLine(localId)];
      return { manualLines, order, invoice: recompute(s.invoice, s.workPackage, manualLines, order, s.invoiceLang) };
    });
    return localId;
  },

  updateManualLine: (localId, patch) =>
    set((s) => {
      const manualLines = s.manualLines.map((m) => (m.localId === localId ? { ...m, item: { ...m.item, ...patch } } : m));
      return { manualLines, invoice: recompute(s.invoice, s.workPackage, manualLines, s.order, s.invoiceLang) };
    }),

  removeManualLine: (localId) =>
    set((s) => {
      const manualLines = s.manualLines.filter((m) => m.localId !== localId);
      const order = s.order.filter((k) => k !== keyForManualLine(localId));
      return { manualLines, order, invoice: recompute(s.invoice, s.workPackage, manualLines, order, s.invoiceLang) };
    }),

  reorderItems: (newOrder) =>
    set((s) => ({ order: newOrder, invoice: recompute(s.invoice, s.workPackage, s.manualLines, newOrder, s.invoiceLang) })),

  loadDocumentSnapshot: (doc) =>
    set((s) => {
      const header: InvoiceHeader = { ...s.invoice, ...doc.invoiceDataSubset } as InvoiceHeader;
      return {
        manualLines: doc.manualLines,
        order: doc.order,
        invoice: recompute(header, s.workPackage, doc.manualLines, doc.order, s.invoiceLang),
      };
    }),

  exportDocumentSnapshot: () => {
    const s = get();
    const { items: _items, ...invoiceDataSubset } = s.invoice;
    return {
      schemaVersion: 1,
      invoiceDataSubset,
      manualLines: s.manualLines,
      order: s.order,
    };
  },

  reset: () =>
    set({
      invoice: makeEmptyInvoice({ language: get().invoiceLang }),
      workPackage: null,
      manualLines: [],
      order: [],
    }),
}));
