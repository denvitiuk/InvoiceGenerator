import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {Currency, ExtraImage, ExtraTable, InvoiceData, Lang, LineItem} from "../../../server/types/invoice.js";


// ---- helpers ---------------------------------------------------------------
const SUPPORTED: Lang[] = ["en", "de", "ru", "bg", "tr"];
const clampLang = (v?: string): Lang => (SUPPORTED.includes(v as Lang) ? (v as Lang) : "en");

const todayISO = () => new Date().toISOString();

export function makeEmptyInvoice(partial?: Partial<InvoiceData>): InvoiceData {
  return {
    language: clampLang(partial?.language ?? "de"),
    currency: (partial?.currency ?? "EUR") as Currency,
    number: partial?.number ?? "",
    issueDateISO: partial?.issueDateISO ?? todayISO(),
    servicePeriod: partial?.servicePeriod,
    dueDays: partial?.dueDays ?? 14,
    reverseCharge: partial?.reverseCharge ?? false,
    kleinunternehmer: partial?.kleinunternehmer ?? false,
    notes: partial?.notes ?? [],
    company: partial?.company ?? { name: "", addressLines: [] },
    client: partial?.client ?? { name: "", addressLines: [] },
    items: partial?.items ?? [],
    extraTables: partial?.extraTables ?? [],
    extraImages: partial?.extraImages ?? [],
  };
}

export function calcTotals(inv: InvoiceData) {
  const subtotalNet = inv.items.reduce((s, it) => s + (it.qty || 0) * (it.unitPrice || 0), 0);
  const vatByRate = new Map<number, number>();
  for (const it of inv.items) {
    const net = (it.qty || 0) * (it.unitPrice || 0);
    const r = it.vatRate || 0;
    const vat = (net * r) / 100;
    vatByRate.set(r, (vatByRate.get(r) || 0) + vat);
  }
  const vatTotal = inv.kleinunternehmer ? 0 : Array.from(vatByRate.values()).reduce((a, b) => a + b, 0);
  const grand = inv.kleinunternehmer ? subtotalNet : subtotalNet + vatTotal;
  return { subtotalNet, vatByRate, vatTotal, grand };
}

// ---- store types -----------------------------------------------------------
export interface AppState {
  uiLang: Lang;            // language of the UI
  invoiceLang: Lang;       // language used for invoice rendering
  invoice: InvoiceData;    // current invoice being edited
  dirty: boolean;          // has unsaved changes

  // basic setters
  setUILang: (lang: Lang) => void;
  setInvoiceLang: (lang: Lang) => void;
  setCurrency: (cur: Currency) => void;
  setIssueDate: (iso: string) => void;
  setDueDays: (days: number) => void;
  setNumber: (num: string) => void;
  setNotes: (notes: string[]) => void;
  setWatermark: (text?: string) => void;
  setReverseCharge: (v: boolean) => void;
  setKleinunternehmer: (v: boolean) => void;

  // company / client
  patchCompany: (patch: Partial<InvoiceData["company"]>) => void;
  patchClient: (patch: Partial<InvoiceData["client"]>) => void;

  // items
  addItem: (item?: Partial<LineItem>) => void;
  updateItem: (index: number, patch: Partial<LineItem>) => void;
  removeItem: (index: number) => void;
  moveItem: (from: number, to: number) => void;
  clearItems: () => void;

  // extras: tables & images
  addExtraTable: (table?: Partial<ExtraTable>) => void;
  updateExtraTable: (index: number, patch: Partial<ExtraTable>) => void;
  removeExtraTable: (index: number) => void;

  addImage: (img: ExtraImage) => void;
  updateImage: (index: number, patch: Partial<ExtraImage>) => void;
  removeImage: (index: number) => void;

  // presets / reset
  loadInvoice: (data: InvoiceData) => void;         // replace current invoice
  resetInvoice: () => void;                          // reset to empty
}

// ---- store implementation --------------------------------------------------
export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      uiLang: clampLang(localStorage.getItem("ui.lang") || "en"),
      invoiceLang: clampLang("de"),
      invoice: makeEmptyInvoice({ language: "de", currency: "EUR" }),
      dirty: false,

      setUILang: (lang) => {
        const v = clampLang(lang);
        localStorage.setItem("ui.lang", v);
        set({ uiLang: v });
      },
      setInvoiceLang: (lang) => set({ invoiceLang: clampLang(lang), invoice: { ...get().invoice, language: clampLang(lang) }, dirty: true }),
      setCurrency: (cur) => set({ invoice: { ...get().invoice, currency: cur }, dirty: true }),
      setIssueDate: (iso) => set({ invoice: { ...get().invoice, issueDateISO: iso }, dirty: true }),
      setDueDays: (days) => set({ invoice: { ...get().invoice, dueDays: Math.max(0, Math.floor(days)) }, dirty: true }),
      setNumber: (num) => set({ invoice: { ...get().invoice, number: num }, dirty: true }),
      setNotes: (notes) => set({ invoice: { ...get().invoice, notes: [...notes] }, dirty: true }),
      setWatermark: (text) => set({ invoice: { ...get().invoice, // watermark is not part of InvoiceData; store it in notes or separate UI state if needed
      }, dirty: true }),
      setReverseCharge: (v) => set({ invoice: { ...get().invoice, reverseCharge: v }, dirty: true }),
      setKleinunternehmer: (v) => set({ invoice: { ...get().invoice, kleinunternehmer: v }, dirty: true }),

      patchCompany: (patch) => set({ invoice: { ...get().invoice, company: { ...get().invoice.company, ...patch } }, dirty: true }),
      patchClient: (patch) => set({ invoice: { ...get().invoice, client: { ...get().invoice.client, ...patch } }, dirty: true }),

      addItem: (item) => set({
        invoice: { ...get().invoice, items: [...get().invoice.items, {
          description: item?.description ?? "",
          qty: item?.qty ?? 1,
          unit: item?.unit ?? "",
          unitPrice: item?.unitPrice ?? 0,
          vatRate: item?.vatRate ?? 19,
        }] },
        dirty: true,
      }),
      updateItem: (index, patch) => set({
        invoice: { ...get().invoice, items: get().invoice.items.map((it, i) => i === index ? { ...it, ...patch } : it) },
        dirty: true,
      }),
      removeItem: (index) => set({
        invoice: { ...get().invoice, items: get().invoice.items.filter((_, i) => i !== index) },
        dirty: true,
      }),
      moveItem: (from, to) => set(() => {
        const arr = [...get().invoice.items];
        const [spliced] = arr.splice(from, 1);
        arr.splice(to, 0, spliced);
        return { invoice: { ...get().invoice, items: arr }, dirty: true };
      }),
      clearItems: () => set({ invoice: { ...get().invoice, items: [] }, dirty: true }),

      addExtraTable: (table) => set({
        invoice: { ...get().invoice, extraTables: [...(get().invoice.extraTables || []), {
          title: table?.title ?? "",
          columns: table?.columns ?? [],
          rows: table?.rows ?? [],
        }] },
        dirty: true,
      }),
      updateExtraTable: (index, patch) => set({
        invoice: { ...get().invoice, extraTables: (get().invoice.extraTables || []).map((t, i) => i === index ? { ...t, ...patch } : t) },
        dirty: true,
      }),
      removeExtraTable: (index) => set({
        invoice: { ...get().invoice, extraTables: (get().invoice.extraTables || []).filter((_, i) => i !== index) },
        dirty: true,
      }),

      addImage: (img) => set({ invoice: { ...get().invoice, extraImages: [...(get().invoice.extraImages || []), img] }, dirty: true }),
      updateImage: (index, patch) => set({
        invoice: { ...get().invoice, extraImages: (get().invoice.extraImages || []).map((im, i) => i === index ? { ...im, ...patch } : im) },
        dirty: true,
      }),
      removeImage: (index) => set({
        invoice: { ...get().invoice, extraImages: (get().invoice.extraImages || []).filter((_, i) => i !== index) },
        dirty: true,
      }),

      loadInvoice: (data) => set({
        invoice: makeEmptyInvoice(data),
        invoiceLang: clampLang(data.language),
        dirty: false,
      }),
      resetInvoice: () => set({ invoice: makeEmptyInvoice({ language: get().invoiceLang }), dirty: false }),
    }),
    {
      name: "invoice.store",
      storage: createJSONStorage(() => localStorage),
      // persist only essential parts
      partialize: (s) => ({ uiLang: s.uiLang, invoiceLang: s.invoiceLang, invoice: s.invoice }),
      version: 1,
    }
  )
);

// Convenient selectors
export const selectors = {
  invoice: (s: AppState) => s.invoice,
  uiLang: (s: AppState) => s.uiLang,
  invoiceLang: (s: AppState) => s.invoiceLang,
  totals: (s: AppState) => calcTotals(s.invoice),
};
