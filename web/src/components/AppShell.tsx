import React from "react";
import { useStore, calcTotals } from "../lib/store";
import { useI18n, useT } from "../lib/i18n";
import { previewInvoice, renderInvoiceBlob, renderAllBlob, openInNewTab } from "../lib/api";

import PreviewPane from "./PreviewPane";
import {Lang} from "../../server/lib/i18n";
import {InvoiceData, NumberingMode} from "@/types/invoice";






const LANGS: Lang[] = ["en", "de", "ru", "bg", "tr","uk"];
const CURRENCIES = ["EUR", "USD", "GBP", "UAH"] as const;
const dbg = (...a: any[]) => console.log("[AppShell]", ...a);

export default function AppShell() {
  const t = useT();
  const { lang: uiLang, setLang: setUILangCtx } = useI18n();

  // Store selectors
  const invoice = useStore((s) => s.invoice as InvoiceData);
  const invoiceLang = useStore((s) => s.invoiceLang as Lang);
  const setInvoiceLang = useStore((s) => s.setInvoiceLang);
  const setCurrency = useStore((s) => s.setCurrency);
  const setDueDays = useStore((s) => s.setDueDays);
  const patchCompany = useStore((s) => s.patchCompany);
  const patchClient = useStore((s) => s.patchClient);
  const patchInvoice = React.useCallback(
    (patch: Partial<InvoiceData>) => {
      useStore.setState((s: any) => ({ invoice: { ...s.invoice, ...patch } }));
    },
    []
  );
  const addItem = useStore((s) => s.addItem);
  const updateItem = useStore((s) => s.updateItem);
  const removeItem = useStore((s) => s.removeItem);

  const totals = React.useMemo(() => calcTotals(invoice), [invoice]);

  // Zahlungsziel (due days) ------------------------------------------------
  // Make it optional in the UI. We will later align server/template behavior
  // so empty really means "do not show".
  const [dueDaysDraft, setDueDaysDraft] = React.useState<string>(() => {
    const v = (invoice as any)?.dueDays;
    return v === undefined || v === null || v === "" ? "" : String(v);
  });

  function commitDueDays(v: string) {
    const vv = (v || "").trim();
    // Empty means: user wants to remove Zahlungsziel
    if (!vv) {
      patchInvoice({ dueDays: undefined } as any);
      return;
    }
    const n = parseInt(vv, 10);
    if (!Number.isFinite(n) || n < 0) return;
    // We patch directly to avoid store forcing a default while the user is typing
    patchInvoice({ dueDays: n } as any);
  }

  // Keep draft in sync when invoice changes externally (load preset / reset)
  React.useEffect(() => {
    const v = (invoice as any)?.dueDays;
    setDueDaysDraft(v === undefined || v === null || v === "" ? "" : String(v));
  }, [(invoice as any)?.dueDays]);

  // Dates helpers ---------------------------------------------------------
  function normalizeISODate(raw: string): string {
    const v = (raw || "").trim();
    if (!v) return "";

    // ISO date: 2025-10-07
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;

    // Common EU formats: 07.10.2025 or 07/10/2025
    const m = v.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
    if (m) {
      const dd = m[1];
      const mm = m[2];
      const yyyy = m[3];
      return `${yyyy}-${mm}-${dd}`;
    }

    return "";
  }

  function isoToDate(iso: string): Date | null {
    const v = normalizeISODate(iso);
    if (!v) return null;
    const [y, m, d] = v.split("-").map((x) => parseInt(x, 10));
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function dateToISO(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function lastDayOfMonth(year: number, month1to12: number): number {
    return new Date(year, month1to12, 0).getDate();
  }

  type PeriodMode = "none" | "custom" | "month" | "week" | "year";

  function inferPeriodMode(sp?: { fromISO?: string; toISO?: string }): PeriodMode {
    const from = isoToDate(sp?.fromISO || "");
    const to = isoToDate(sp?.toISO || "");
    if (!from && !to) return "none";
    if (!from || !to) return "custom";

    // year: Jan 1 .. Dec 31
    if (
      from.getMonth() === 0 &&
      from.getDate() === 1 &&
      to.getMonth() === 11 &&
      to.getDate() === 31 &&
      from.getFullYear() === to.getFullYear()
    ) {
      return "year";
    }

    // month: 1st .. last day of same month
    const sameMonth = from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth();
    if (sameMonth && from.getDate() === 1) {
      const ld = lastDayOfMonth(from.getFullYear(), from.getMonth() + 1);
      if (to.getDate() === ld) return "month";
    }

    // week: Monday..Sunday (difference 6 days)
    const diffDays = Math.round((to.getTime() - from.getTime()) / 86400000);
    const mondayIndex = (from.getDay() + 6) % 7; // Monday=0
    const sundayIndex = (to.getDay() + 6) % 7; // Sunday=6
    if (diffDays === 6 && mondayIndex === 0 && sundayIndex === 6) return "week";

    return "custom";
  }

  function monthToRange(yyyyMm: string): { fromISO: string; toISO: string } | null {
    const v = (yyyyMm || "").trim();
    if (!/^\d{4}-\d{2}$/.test(v)) return null;
    const [yS, mS] = v.split("-");
    const y = parseInt(yS, 10);
    const m = parseInt(mS, 10);
    if (!y || !m) return null;
    const from = new Date(y, m - 1, 1);
    const to = new Date(y, m - 1, lastDayOfMonth(y, m));
    return { fromISO: dateToISO(from), toISO: dateToISO(to) };
  }

  function yearToRange(year: string): { fromISO: string; toISO: string } | null {
    const y = parseInt((year || "").trim(), 10);
    if (!y || y < 1900 || y > 3000) return null;
    return { fromISO: `${y}-01-01`, toISO: `${y}-12-31` };
  }

  function weekToRange(anchorIso: string): { fromISO: string; toISO: string } | null {
    const d = isoToDate(anchorIso);
    if (!d) return null;
    const dayIndex = (d.getDay() + 6) % 7; // Monday=0
    const from = new Date(d);
    from.setDate(d.getDate() - dayIndex);
    const to = new Date(from);
    to.setDate(from.getDate() + 6);
    return { fromISO: dateToISO(from), toISO: dateToISO(to) };
  }

  function setServicePeriod(patch: { fromISO?: string; toISO?: string }) {
    const current = (invoice as any)?.servicePeriod || {};
    const merged = { ...current, ...patch };
    if (!merged.fromISO && !merged.toISO) {
      patchInvoice({ servicePeriod: undefined } as any);
    } else {
      patchInvoice({ servicePeriod: merged } as any);
    }
  }

  const [periodMode, setPeriodMode] = React.useState<PeriodMode>(() => inferPeriodMode((invoice as any)?.servicePeriod));
  const [periodMonth, setPeriodMonth] = React.useState<string>(() => {
    const sp = (invoice as any)?.servicePeriod;
    const from = normalizeISODate(sp?.fromISO || "");
    if (from) return from.slice(0, 7); // YYYY-MM
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  // Draft to avoid re-render/patch while the user is still typing year/month in the picker
  const [periodMonthDraft, setPeriodMonthDraft] = React.useState<string>(periodMonth);

  function commitMonth(v: string) {
    const vv = (v || "").trim();
    if (!/^\d{4}-\d{2}$/.test(vv)) return;
    setPeriodMonth(vv);
    const r = monthToRange(vv);
    if (r) patchInvoice({ servicePeriod: r } as any);
  }

  // Keep draft in sync when value is changed externally (e.g., loading invoice/preset)
  React.useEffect(() => {
    setPeriodMonthDraft(periodMonth);
  }, [periodMonth]);
  const [periodWeekAnchor, setPeriodWeekAnchor] = React.useState<string>(() => {
    const sp = (invoice as any)?.servicePeriod;
    const from = normalizeISODate(sp?.fromISO || "");
    if (from) return from;
    return dateToISO(new Date());
  });
  const [periodYear, setPeriodYear] = React.useState<string>(() => {
    const sp = (invoice as any)?.servicePeriod;
    const from = normalizeISODate(sp?.fromISO || "");
    if (from) return from.slice(0, 4);
    return String(new Date().getFullYear());
  });

  function clearServicePeriod() {
    patchInvoice({ servicePeriod: undefined } as any);
  }

  function applyPeriodMode(next: PeriodMode) {
    setPeriodMode(next);

    if (next === "none") {
      clearServicePeriod();
      return;
    }

    if (next === "custom") {
      // Keep existing range, but if there is none, initialize to today..today
      const cur = (invoice as any)?.servicePeriod;
      const hasAny = Boolean(cur?.fromISO || cur?.toISO);
      if (!hasAny) {
        const today = dateToISO(new Date());
        patchInvoice({ servicePeriod: { fromISO: today, toISO: today } } as any);
      }
      return;
    }

    if (next === "month") {
      // use draft to avoid forcing a value mid-edit
      const candidate = periodMonthDraft || periodMonth;
      const r = monthToRange(candidate);
      if (r) {
        patchInvoice({ servicePeriod: r } as any);
      } else {
        // fall back to current month
        const now = new Date();
        const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        setPeriodMonthDraft(fallback);
        setPeriodMonth(fallback);
        const rr = monthToRange(fallback);
        if (rr) patchInvoice({ servicePeriod: rr } as any);
      }
      return;
    }

    if (next === "week") {
      const r = weekToRange(periodWeekAnchor);
      if (r) patchInvoice({ servicePeriod: r } as any);
      return;
    }

    if (next === "year") {
      const r = yearToRange(periodYear);
      if (r) patchInvoice({ servicePeriod: r } as any);
      return;
    }
  }

  // Keep mode in sync if invoice is loaded/changed externally
  React.useEffect(() => {
    setPeriodMode(inferPeriodMode((invoice as any)?.servicePeriod));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    (invoice as any)?.servicePeriod?.fromISO,
    (invoice as any)?.servicePeriod?.toISO,
  ]);

  // Auto-migrate non-ISO dates (e.g. DD.MM.YYYY) into ISO so <input type="date"> works
  React.useEffect(() => {
    const rawIssue = ((invoice as any)?.issueDateISO || "").trim();
    const normalizedIssue = normalizeISODate(rawIssue);
    if (rawIssue && normalizedIssue && rawIssue !== normalizedIssue) {
      patchInvoice({ issueDateISO: normalizedIssue } as any);
    }

    const rawFrom = (((invoice as any)?.servicePeriod?.fromISO) || "").trim();
    const normalizedFrom = normalizeISODate(rawFrom);
    if (rawFrom && normalizedFrom && rawFrom !== normalizedFrom) {
      setServicePeriod({ fromISO: normalizedFrom });
    }

    const rawTo = (((invoice as any)?.servicePeriod?.toISO) || "").trim();
    const normalizedTo = normalizeISODate(rawTo);
    if (rawTo && normalizedTo && rawTo !== normalizedTo) {
      setServicePeriod({ toISO: normalizedTo });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helpers ---------------------------------------------------------------
  function downloadBlob(name: string, blob: Blob) {
    dbg("downloadBlob", { name, size: blob.size, type: blob.type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function downloadFromOut(path: string, name?: string) {
    dbg("downloadFromOut", { path, name });
    const url = `/download?path=${encodeURIComponent(path)}${name ? `&name=${encodeURIComponent(name)}` : ""}`;
    const a = document.createElement("a");
    a.href = url;
    if (name) a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Actions --------------------------------------------------------------
  async function onRenderPDF() {
    try {
      dbg("onRenderPDF:start", { invoiceLang, fileName: (invoice as any).fileName });
      const { blob, filename } = await renderInvoiceBlob(invoice, invoiceLang);
      dbg("onRenderPDF:gotBlob", { filename, size: blob.size, type: blob.type });
      downloadBlob(filename, blob);
      alert(`${t("success_render")}: ${filename}`);
    } catch (e: any) {
      dbg("onRenderPDF:error", e);
      alert(e?.message || "Render failed");
    }
  }

  async function onRenderAll() {
    try {
      dbg("onRenderAll:start", { all: true, fileName: (invoice as any).fileName });
      const { blob, filename } = await renderAllBlob(invoice, { all: true });
      dbg("onRenderAll:gotBlob", { filename, size: blob.size, type: blob.type });
      downloadBlob(filename, blob);
      alert(`${t("success_render_all")}: ${filename}`);
    } catch (e: any) {
      dbg("onRenderAll:error", e);
      alert(e?.message || "ZIP failed");
    }
  }

  async function onOpenPreview() {
    try {
      dbg("onOpenPreview:start", { invoiceLang });
      const h = await previewInvoice(invoice, invoiceLang);
      dbg("onOpenPreview:htmlLength", h?.length);
      openInNewTab(h);
    } catch (e: any) {
      alert(e?.message || "Preview failed");
    }
  }

  function onDownloadLastData() {
    dbg("onDownloadLastData");
    const pretty = JSON.stringify(invoice, null, 2);
    const blob = new Blob([pretty], { type: "application/json" });
    const name = `invoice-last-${new Date().toISOString().slice(0,10)}.json`;
    dbg("onDownloadLastData:download", { name });
    downloadBlob(name, blob);
  }

  // Layout ---------------------------------------------------------------
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 560px) 1fr", height: "100vh" }}>
      {/* Left column: form */}
      <div style={{ padding: 16, overflow: "auto", borderRight: "1px solid #eee" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18 }}>{t("app_title")}</h1>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              value={uiLang}
              onChange={(e) => { const v = e.target.value as Lang; dbg("setUILang", v); setUILangCtx(v); }}
              title={t("language_ui")}
            >
              {LANGS.map((l) => (<option key={l} value={l}>{l.toUpperCase()}</option>))}
            </select>
            <select
              value={invoiceLang}
              onChange={(e) => { const v = e.target.value as Lang; dbg("setInvoiceLang", v); setInvoiceLang(v); }}
              title={t("language_invoice")}
            >
              {LANGS.map((l) => (<option key={l} value={l}>{l.toUpperCase()}</option>))}
            </select>
          </div>
        </header>

        {/* Company */}
        <section style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>{t("section_company")}</h3>
          <input
            placeholder="Company name"
            value={invoice.company.name}
            onChange={(e) => patchCompany({ name: e.target.value })}
            style={{ width: "100%", marginBottom: 8 }}
          />
          <textarea
            placeholder={t("address")}
            value={(invoice.company.addressLines || []).join("\n")}
            onChange={(e) => patchCompany({ addressLines: e.target.value.split(/\r?\n/) })}
            rows={3}
            style={{ width: "100%", marginBottom: 8 }}
          />

          {/* Contacts */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input
              placeholder={t("email") || "Email"}
              value={invoice.company.email || ""}
              onChange={(e) => patchCompany({ email: e.target.value })}
            />
            <input
              placeholder={t("phone") || "Phone"}
              value={invoice.company.phone || ""}
              onChange={(e) => patchCompany({ phone: e.target.value })}
            />
            <input
              placeholder={t("website") || "Website"}
              value={invoice.company.website || ""}
              onChange={(e) => patchCompany({ website: e.target.value })}
            />
          </div>

          {/* Bank details */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <input
              placeholder={t("iban") || "IBAN"}
              value={invoice.company.iban || ""}
              onChange={(e) => patchCompany({ iban: e.target.value.replace(/\s+/g, "") })}
            />
            <input
              placeholder={t("bic") || "BIC"}
              value={invoice.company.bic || ""}
              onChange={(e) => patchCompany({ bic: e.target.value.toUpperCase().replace(/\s+/g, "") })}
            />
            <input
              placeholder={t("bank_name") || "Bank name"}
              value={invoice.company.bankName || ""}
              onChange={(e) => patchCompany({ bankName: e.target.value })}
              style={{ gridColumn: "1 / span 2" }}
            />
          </div>
          {/* Tax identifiers */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <input
              placeholder={"USt-IdNr."}
              value={invoice.company.ustId || ""}
              onChange={(e) => patchCompany({ ustId: e.target.value })}
            />
            <input
              placeholder={"Steuernummer"}
              value={invoice.company.steuerNr || ""}
              onChange={(e) => patchCompany({ steuerNr: e.target.value })}
            />
          </div>
        </section>

        {/* Client */}
        <section style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>{t("section_client")}</h3>
          <input
            placeholder="Client name"
            value={invoice.client.name}
            onChange={(e) => patchClient({ name: e.target.value })}
            style={{ width: "100%", marginBottom: 8 }}
          />
          <textarea
            placeholder={t("address")}
            value={(invoice.client.addressLines || []).join("\n")}
            onChange={(e) => patchClient({ addressLines: e.target.value.split(/\r?\n/) })}
            rows={3}
            style={{ width: "100%" }}
          />
        </section>

        {/* Meta */}
        <section style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("currency")}</label>
            <select value={invoice.currency} onChange={(e) => setCurrency(e.target.value as any)} style={{ width: "100%" }}>
              {CURRENCIES.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("due_days") || "Zahlungsziel (Tage)"}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="number"
                min={0}
                placeholder=""
                value={dueDaysDraft}
                onChange={(e) => {
                  // Do NOT patch invoice while user types
                  setDueDaysDraft(e.target.value);
                }}
                onBlur={() => commitDueDays(dueDaysDraft)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                    commitDueDays(dueDaysDraft);
                  }
                }}
                style={{ width: "100%" }}
              />
              <button
                type="button"
                onClick={() => {
                  setDueDaysDraft("");
                  patchInvoice({ dueDays: undefined } as any);
                }}
                title={t("remove") || "Remove"}
              >
                ×
              </button>
            </div>
          </div>
        </section>

        {/* Dates */}
        <section style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>{t("section_dates") || "Dates"}</h3>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("issue_date") || "Rechnungsdatum"}</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="date"
                  value={normalizeISODate((invoice as any)?.issueDateISO || "")}
                  onChange={(e) => patchInvoice({ issueDateISO: e.target.value } as any)}
                  style={{ width: "100%" }}
                />
                <button
                  type="button"
                  onClick={() => patchInvoice({ issueDateISO: "" } as any)}
                  title={t("clear") || "Clear"}
                >
                  ×
                </button>
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("billing_period") || "Abrechnungszeitraum"}</label>
              <select
                value={periodMode}
                onChange={(e) => applyPeriodMode(e.target.value as PeriodMode)}
                style={{ width: "100%" }}
              >
                <option value="none">{t("period_none") || "Ohne Zeitraum"}</option>
                <option value="month">{t("period_month") || "Monat"}</option>
                <option value="week">{t("period_week") || "Woche"}</option>
                <option value="year">{t("period_year") || "Jahr"}</option>
                <option value="custom">{t("period_custom") || "Benutzerdefiniert"}</option>
              </select>
            </div>
          </div>

          {/* Presets */}
          {periodMode === "month" && (
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("select_month") || "Monat wählen"}</label>
                <input
                  type="month"
                  value={periodMonthDraft}
                  onChange={(e) => {
                    // do NOT patch invoice while user types — it can interrupt typing
                    setPeriodMonthDraft(e.target.value);
                  }}
                  onBlur={() => commitMonth(periodMonthDraft)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                      commitMonth(periodMonthDraft);
                    }
                  }}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ alignSelf: "end", fontSize: 12, opacity: 0.75 }}>
                {(invoice as any)?.servicePeriod?.fromISO && (invoice as any)?.servicePeriod?.toISO
                  ? `${(invoice as any).servicePeriod.fromISO} → ${(invoice as any).servicePeriod.toISO}`
                  : ""}
              </div>
            </div>
          )}

          {periodMode === "week" && (
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("select_week") || "Woche (Datum wählen)"}</label>
                <input
                  type="date"
                  value={periodWeekAnchor}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPeriodWeekAnchor(v);
                    const r = weekToRange(v);
                    if (r) patchInvoice({ servicePeriod: r } as any);
                  }}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ alignSelf: "end", fontSize: 12, opacity: 0.75 }}>
                {(invoice as any)?.servicePeriod?.fromISO && (invoice as any)?.servicePeriod?.toISO
                  ? `${(invoice as any).servicePeriod.fromISO} → ${(invoice as any).servicePeriod.toISO}`
                  : ""}
              </div>
            </div>
          )}

          {periodMode === "year" && (
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("select_year") || "Jahr wählen"}</label>
                <input
                  type="number"
                  min={1900}
                  max={3000}
                  value={periodYear}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPeriodYear(v);
                    const r = yearToRange(v);
                    if (r) patchInvoice({ servicePeriod: r } as any);
                  }}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ alignSelf: "end", fontSize: 12, opacity: 0.75 }}>
                {(invoice as any)?.servicePeriod?.fromISO && (invoice as any)?.servicePeriod?.toISO
                  ? `${(invoice as any).servicePeriod.fromISO} → ${(invoice as any).servicePeriod.toISO}`
                  : ""}
              </div>
            </div>
          )}

          {/* Custom range */}
          {periodMode === "custom" && (
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("service_from") || "Von"}</label>
                <input
                  type="date"
                  value={normalizeISODate((invoice as any)?.servicePeriod?.fromISO || "")}
                  onChange={(e) => setServicePeriod({ fromISO: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("service_to") || "Bis"}</label>
                <input
                  type="date"
                  value={normalizeISODate((invoice as any)?.servicePeriod?.toISO || "")}
                  onChange={(e) => setServicePeriod({ toISO: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ gridColumn: "1 / span 2", display: "flex", gap: 8 }}>
                <button type="button" onClick={() => clearServicePeriod()}>
                  {t("remove_period") || "Zeitraum entfernen"}
                </button>
              </div>
            </div>
          )}

          {periodMode === "none" && (
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
              {t("period_disabled_hint") || "Kein Abrechnungszeitraum wird auf dem Dokument angezeigt."}
            </div>
          )}
        </section>

        {/* Document options (title/number/file name) */}
        <section style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div style={{ gridColumn: "1 / span 2" }}>
            <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("document_title") || "Document title"}</label>
            <input
              value={(invoice as any).documentTitle || ""}
              onChange={(e) => patchInvoice({ documentTitle: e.target.value } as any)}
              placeholder="Invoice"
              style={{ width: "100%" }}
            />
          </div>
          {/* Numbering mode and number controls */}
          <div>
            <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("numbering_mode") || "Numbering mode"}</label>
            <select
              value={invoice.numberingMode ?? "auto"}
              onChange={e => patchInvoice({ numberingMode: e.target.value as NumberingMode })}
              style={{ width: "100%" }}
            >
              <option value="auto">{t("numbering_auto") || "Auto"}</option>
              <option value="manual">{t("numbering_manual") || "Manual"}</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("number") || "Number"}</label>
            <input
              value={invoice.number || ""}
              onChange={e => patchInvoice({ number: e.target.value })}
              placeholder={t("number") || "Number"}
              style={{ width: "100%" }}
              disabled={(invoice.numberingMode ?? "auto") === "auto"}
            />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={Boolean((invoice as any).showNumberInTitle)}
              onChange={(e) => patchInvoice({ showNumberInTitle: e.target.checked } as any)}
            />
            <span>{t("show_number_in_title") || "Show number in title"}</span>
          </label>
          <div>
            <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("filename") || "Filename"}</label>
            <input
              value={(invoice as any).fileName || ""}
              onChange={(e) => patchInvoice({ fileName: e.target.value } as any)}
              placeholder="invoice"
              style={{ width: "100%" }}
            />
          </div>
        </section>

        {/* Items */}
        <section style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>{t("section_items")}</h3>
          {invoice.items.map((it, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 0.6fr 0.6fr 0.8fr 0.6fr auto", gap: 6, alignItems: "center", marginBottom: 6 }}>
              <input value={it.description} onChange={(e) => updateItem(i, { description: e.target.value })} placeholder={t("description")} />
              <input type="number" step="0.01" value={it.qty} onChange={(e) => updateItem(i, { qty: parseFloat(e.target.value || "0") })} placeholder={t("qty")} />
              <input value={it.unit || ""} onChange={(e) => updateItem(i, { unit: e.target.value })} placeholder={t("unit")} />
              <input type="number" step="0.01" value={it.unitPrice} onChange={(e) => updateItem(i, { unitPrice: parseFloat(e.target.value || "0") })} placeholder={t("unit_price")} />
              <input type="number" step="0.1" value={it.vatRate} onChange={(e) => updateItem(i, { vatRate: parseFloat(e.target.value || "0") })} placeholder={t("vat_rate")} />
              <button onClick={() => removeItem(i)}>{t("remove")}</button>
            </div>
          ))}
          <button onClick={() => addItem({ qty: 1, unitPrice: 0, vatRate: 19 })} style={{ marginTop: 6 }}>{t("add_item")}</button>
        </section>

        {/* Totals (quick view) */}
        <section style={{ marginTop: 16, fontSize: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>{t("subtotal") || "Subtotal"}</div>
            <div>{totals.subtotalNet.toFixed(2)}</div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>{"VAT"}</div>
            <div>{totals.vatTotal.toFixed(2)}</div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
            <div>{t("total") || "Total"}</div>
            <div>{totals.grand.toFixed(2)}</div>
          </div>
        </section>

        {/* Actions */}
        <section style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={onOpenPreview}>{t("preview")}</button>
          <button onClick={onRenderPDF}>{t("generate_pdf")}</button>
          <button onClick={onRenderAll}>{t("generate_all")}</button>
          <button onClick={onDownloadLastData}>{t("download_last_data") || "Letzte Daten herunterladen"}</button>
        </section>
      </div>

      {/* Right column: live preview */}
      <PreviewPane invoice={invoice} language={invoiceLang} debounceMs={250} />
    </div>
  );
}
