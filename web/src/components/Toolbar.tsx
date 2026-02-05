import React, { useRef, useState } from "react";
import { useI18n, useT } from "../lib/i18n";
import type { UILang } from "../lib/i18n";

import { useStore } from "../lib/store";
import { uploadFile } from "../lib/api";
import {Lang} from "../../server/lib/i18n";
import {NumberingMode} from "@/types/invoice";


const LANGS: Lang[] = ["en", "de", "ru", "bg", "uk" , "tr"];

export interface ToolbarProps {
  onPreview?: () => void;
  onRenderPDF?: () => void;
  onRenderAll?: () => void;
  onDownloadLast?: () => void;
  onRestoreLast?: () => void;
  className?: string;
}

export default function Toolbar({ onPreview, onRenderPDF, onRenderAll, onDownloadLast, onRestoreLast, className }: ToolbarProps) {
  const t = useT();
  const { lang: uiLang, setLang: setUILangCtx } = useI18n();

  const invoiceLang = useStore((s) => s.invoiceLang);
  const setInvoiceLang = useStore((s) => s.setInvoiceLang);
  const patchCompany = useStore((s) => s.patchCompany);

  const invoice = useStore((s) => s.invoice);
  const setNumber = useStore((s) => s.setNumber);
  const setNumberingMode = useStore((s) => s.setNumberingMode);
  const setDocumentTitle = useStore((s) => s.setDocumentTitle);
  const setShowNumberInTitle = useStore((s) => s.setShowNumberInTitle);
  const setFileName = useStore((s) => s.setFileName);

  // Theme / Palette (Receipt Pro)
  const applyThemePreset = useStore((s: any) => s.applyThemePreset);
  const clearTheme = useStore((s: any) => s.clearTheme);
  const patchThemeColors = useStore((s: any) => s.patchThemeColors);
  const setThemeRoundness = useStore((s: any) => s.setThemeRoundness);

  const [showPalette, setShowPalette] = useState(false);

  const MODES: NumberingMode[] = ["auto", "manual"];

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
          onChange={(e) => { setUILangCtx(e.target.value as UILang); }}
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
          {uploading ? "…" : (t("add_logo") || "Add logo")}
        </button>
      </div>

      {/* Receipt Pro style + palette */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          onClick={() => {
            applyThemePreset?.("receiptPro");
            setShowPalette(true);
          }}
          title="Apply Receipt Pro style"
        >
          Receipt Pro
        </button>
        <button
          onClick={() => {
            clearTheme?.();
            setShowPalette(false);
          }}
          title="Reset to classic"
        >
          Classic
        </button>
        <button onClick={() => setShowPalette((v) => !v)} title="Customize colors">
          Palette
        </button>
      </div>

      {showPalette && (
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            padding: "6px 8px",
            border: "1px solid #e5e7eb",
            borderRadius: 10,
          }}
        >
          <label style={{ fontSize: 12, opacity: 0.8 }}>
            Primary{" "}
            <input
              type="color"
              value={(invoice as any)?.theme?.colors?.primary || "#0B1220"}
              onChange={(e) => patchThemeColors?.({ primary: e.target.value })}
              style={{ marginLeft: 6 }}
            />
          </label>

          <label style={{ fontSize: 12, opacity: 0.8 }}>
            Accent{" "}
            <input
              type="color"
              value={(invoice as any)?.theme?.colors?.accent || "#00C2FF"}
              onChange={(e) => patchThemeColors?.({ accent: e.target.value })}
              style={{ marginLeft: 6 }}
            />
          </label>

          <label style={{ fontSize: 12, opacity: 0.8 }}>
            Text{" "}
            <input
              type="color"
              value={(invoice as any)?.theme?.colors?.text || "#0B1220"}
              onChange={(e) => patchThemeColors?.({ text: e.target.value })}
              style={{ marginLeft: 6 }}
            />
          </label>

          <label style={{ fontSize: 12, opacity: 0.8 }}>
            Background{" "}
            <input
              type="color"
              value={(invoice as any)?.theme?.colors?.background || "#FFFFFF"}
              onChange={(e) => patchThemeColors?.({ background: e.target.value })}
              style={{ marginLeft: 6 }}
            />
          </label>

          <label style={{ fontSize: 12, opacity: 0.8 }}>
            Round{" "}
            <input
              type="range"
              min={0}
              max={24}
              value={(invoice as any)?.theme?.layout?.roundness ?? 18}
              onChange={(e) => setThemeRoundness?.(parseInt(e.target.value, 10))}
              style={{ marginLeft: 6 }}
            />
            <span style={{ marginLeft: 6, fontSize: 12, opacity: 0.8 }}>
              {((invoice as any)?.theme?.layout?.roundness ?? 18)}px
            </span>
          </label>
        </div>
      )}

      {/* Document options (title / numbering / number / filename) */}
      <label style={{ fontSize: 12, opacity: 0.8 }}>
        {t("document_title") || "Document title"}: {" "}
        <input
          type="text"
          value={invoice.documentTitle ?? ""}
          onChange={(e) => setDocumentTitle(e.target.value)}
          placeholder={t("document_title") || "Document title"}
          style={{ marginLeft: 6, width: 180 }}
        />
      </label>

      <label style={{ fontSize: 12, opacity: 0.8 }}>
        {t("show_number_in_title") || "Show number in title"}: {" "}
        <input
          type="checkbox"
          checked={!!invoice.showNumberInTitle}
          onChange={(e) => setShowNumberInTitle(e.target.checked)}
          style={{ marginLeft: 6 }}
        />
      </label>

      <label style={{ fontSize: 12, opacity: 0.8 }}>
        {t("numbering_mode") || "Numbering"}: {" "}
        <select
          value={(invoice.numberingMode as NumberingMode) || "auto"}
          onChange={(e) => setNumberingMode(e.target.value as NumberingMode)}
          style={{ marginLeft: 6 }}
        >
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m === "auto" ? (t("numbering_auto") || "Auto") : (t("numbering_manual") || "Manual")}
            </option>
          ))}
        </select>
      </label>

      <label style={{ fontSize: 12, opacity: 0.8 }}>
        {t("number") || "Number"}: {" "}
        <input
          type="text"
          value={invoice.number ?? ""}
          onChange={(e) => setNumber(e.target.value)}
          disabled={(invoice.numberingMode as NumberingMode) !== "manual"}
          placeholder={t("number") || "Number"}
          style={{ marginLeft: 6, width: 160 }}
        />
      </label>

      <label style={{ fontSize: 12, opacity: 0.8 }}>
        {t("filename") || "Filename"}: {" "}
        <input
          type="text"
          value={invoice.fileName ?? ""}
          onChange={(e) => setFileName(e.target.value)}
          placeholder={t("filename") || "Filename"}
          style={{ marginLeft: 6, width: 180 }}
        />
      </label>

      {/* Actions */}
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        {onDownloadLast && (
          <button onClick={onDownloadLast}>{t("download_last_data")}</button>
        )}
        {onRestoreLast && (
          <button onClick={onRestoreLast}>{t("restore_last_data")}</button>
        )}
        {onPreview && (
          <button onClick={onPreview}>{t("preview")}</button>
        )}
        {onRenderPDF && (
          <button onClick={onRenderPDF}>{t("generate_pdf")}</button>
        )}
        {onRenderAll && (
          <button onClick={onRenderAll}>{t("generate_all")}</button>
        )}
      </div>
    </div>
  );
}