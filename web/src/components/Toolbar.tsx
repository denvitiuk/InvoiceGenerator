import React, { useRef, useState } from "react";
import { useI18n, useT } from "../lib/i18n";

import { useStore } from "../lib/store";
import { uploadFile } from "../lib/api";
import type { Lang, InvoiceData } from "../../../server/types/invoice";

const LANGS: Lang[] = ["en", "de", "ru", "bg", "tr"];

export interface ToolbarProps {
  onPreview?: () => void;
  onRenderPDF?: () => void;
  onRenderAll?: () => void;
  className?: string;
}

export default function Toolbar({ onPreview, onRenderPDF, onRenderAll, className }: ToolbarProps) {
  const t = useT();
  const { lang: uiLang, setLang: setUILangCtx } = useI18n();

  const invoiceLang = useStore((s) => s.invoiceLang);
  const setInvoiceLang = useStore((s) => s.setInvoiceLang);
  const patchCompany = useStore((s) => s.patchCompany);
  const invoice = useStore((s) => s.invoice as InvoiceData);

  // upload logo
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const resp = await uploadFile(f);
      patchCompany({ logoPath: resp.path });
    } catch (err: any) {
      alert(err?.message || "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = ""; // reset so same file can be picked again
    }
  }

  return (
    <div className={className} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {/* UI Language */}
      <label style={{ fontSize: 12, opacity: 0.8 }}>
        {t("language_ui")}:{" "}
        <select
          value={uiLang}
          onChange={(e) => { setUILangCtx(e.target.value as Lang); }}
          style={{ marginLeft: 6 }}
        >
          {LANGS.map((l) => (<option key={l} value={l}>{l.toUpperCase()}</option>))}
        </select>
      </label>

      {/* Invoice Language */}
      <label style={{ fontSize: 12, opacity: 0.8 }}>
        {t("language_invoice")}:{" "}
        <select
          value={invoiceLang}
          onChange={(e) => setInvoiceLang(e.target.value as Lang)}
          style={{ marginLeft: 6 }}
        >
          {LANGS.map((l) => (<option key={l} value={l}>{l.toUpperCase()}</option>))}
        </select>
      </label>

      {/* Upload Logo */}
      <div>
        <input ref={fileRef} type="file" accept="image/*,.svg,.pdf" style={{ display: "none" }} onChange={handleFileChange} />
        <button onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? "…" : t("upload")} {t("logo")}
        </button>
      </div>

      {/* Actions */}
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        {onPreview && (
          <button onClick={onPreview}>{t("preview")}</button>
        )}
        {onRenderPDF && (
          <button
            onClick={() => (onRenderPDF as any)({ data: invoice, language: invoiceLang })}
          >
            {t("generate_pdf")}
          </button>
        )}
        {onRenderAll && (
          <button
            onClick={() => (onRenderAll as any)({ data: invoice, all: true })}
          >
            {t("generate_all")}
          </button>
        )}
      </div>
    </div>
  );
}