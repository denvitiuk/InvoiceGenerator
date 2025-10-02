import React from "react";
import { useStore, calcTotals } from "../lib/store";
import { useI18n, useT } from "../lib/i18n";
import { previewInvoice, renderAll, renderInvoice, openInNewTab } from "../lib/api";

import PreviewPane from "./PreviewPane";
import {InvoiceData, Lang} from "../../../server/types/invoice";




const LANGS: Lang[] = ["en", "de", "ru", "bg", "tr"];
const CURRENCIES = ["EUR", "USD", "GBP"] as const;

export default function AppShell() {
  const t = useT();
  const { lang: uiLang, setLang: setUILangCtx } = useI18n();

  const invoice = useStore((s) => s.invoice as InvoiceData);
  const invoiceLang = useStore((s) => s.invoiceLang);
  const setInvoiceLang = useStore((s) => s.setInvoiceLang);
  const setCurrency = useStore((s) => s.setCurrency);
  const setDueDays = useStore((s) => s.setDueDays);
  const patchCompany = useStore((s) => s.patchCompany);
  const patchClient = useStore((s) => s.patchClient);
  const addItem = useStore((s) => s.addItem);
  const updateItem = useStore((s) => s.updateItem);
  const removeItem = useStore((s) => s.removeItem);
  const totals = React.useMemo(() => calcTotals(invoice), [invoice]);

  // --- actions --------------------------------------------------------------
  async function onRenderPDF() {
    try {
      const resp = await renderInvoice(invoice, invoiceLang);
      alert(`${t("success_render")}: ${resp.name}`);
    } catch (e: any) {
      alert(e?.message || "Render failed");
    }
  }

  async function onRenderAll() {
    try {
      const resp = await renderAll(invoice, { all: true });
      alert(`${t("success_render_all")}: ${resp.zip}`);
    } catch (e: any) {
      alert(e?.message || "ZIP failed");
    }
  }

  async function onOpenPreview() {
    try {
      const h = await previewInvoice(invoice, invoiceLang);
      openInNewTab(h);
    } catch (e: any) {
      alert(e?.message || "Preview failed");
    }
  }

  // --- layout ---------------------------------------------------------------
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 520px) 1fr", height: "100vh" }}>
      {/* Left column: form */}
      <div style={{ padding: 16, overflow: "auto", borderRight: "1px solid #eee" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18 }}>{t("app_title")}</h1>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              value={uiLang}
              onChange={(e) => { setUILangCtx(e.target.value as Lang); }}
              title={t("language_ui")}
            >
              {LANGS.map((l) => (<option key={l} value={l}>{l.toUpperCase()}</option>))}
            </select>
            <select
              value={invoiceLang}
              onChange={(e) => setInvoiceLang(e.target.value as Lang)}
              title={t("language_invoice")}
            >
              {LANGS.map((l) => (<option key={l} value={l}>{l.toUpperCase()}</option>))}
            </select>
          </div>
        </header>

        {/* Company / Client */}
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
            style={{ width: "100%" }}
          />
        </section>

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
        </section>
      </div>

      {/* Right column: live preview */}
      <PreviewPane invoice={invoice} language={invoiceLang} debounceMs={250} />
    </div>
  );
}
