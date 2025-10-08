import React from "react";
import { useStore, calcTotals } from "../lib/store";
import { useI18n, useT } from "../lib/i18n";
import { previewInvoice, renderInvoiceBlob, renderAllBlob, openInNewTab } from "../lib/api";

import PreviewPane from "./PreviewPane";
import {InvoiceData, Lang, NumberingMode} from "../../../server/types/invoice";




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
            <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("due_days")}</label>
            <input type="number" min={0} value={invoice.dueDays || 0} onChange={(e) => setDueDays(parseInt(e.target.value || "0"))} style={{ width: "100%" }} />
          </div>
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
