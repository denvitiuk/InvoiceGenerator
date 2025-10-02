

import React, { useEffect, useState } from "react";

import { previewInvoice } from "../lib/api";
import {InvoiceData, Lang} from "../../../server/types/invoice";

export interface PreviewPaneProps {
  invoice: InvoiceData;
  language: Lang;
  debounceMs?: number;
  className?: string;
}

export default function PreviewPane({ invoice, language, debounceMs = 250, className }: PreviewPaneProps) {
  const [html, setHtml] = useState<string>("<p style='padding:12px;font-family:sans-serif'>Loading…</p>");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      setErr(null);
      try {
        const h = await previewInvoice(invoice, language);
        if (!alive) return;
        setHtml(h);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Preview failed");
      } finally {
        if (alive) setLoading(false);
      }
    }, debounceMs);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [invoice, language, debounceMs]);

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      {loading && (
        <div style={{ position: "absolute", top: 8, right: 8, background: "#fff", border: "1px solid #eee", padding: "4px 8px", borderRadius: 6, fontSize: 12 }}>
          Loading…
        </div>
      )}
      {err && (
        <div style={{ position: "absolute", top: 8, left: 8, background: "#fee", color: "#900", border: "1px solid #f99", padding: "6px 8px", borderRadius: 6, fontSize: 12 }}>
          {err}
        </div>
      )}
      <iframe title="preview" style={{ width: "100%", height: "100%", border: 0, background: "#fff" }} srcDoc={html} />
    </div>
  );
}