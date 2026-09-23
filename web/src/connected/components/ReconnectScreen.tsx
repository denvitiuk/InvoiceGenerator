import React, { useState } from "react";
import { useT } from "@/lib/i18n";
import type { ApiErrorKind } from "../session/sessionMachine";

const ERROR_KEY_BY_KIND: Record<ApiErrorKind, string> = {
  unauthorized: "connected_error_unauthorized",
  forbidden: "connected_error_forbidden",
  not_found: "connected_error_not_found",
  conflict: "connected_error_conflict",
  rate_limited: "connected_error_rate_limited",
  server_error: "connected_error_server",
  network_error: "connected_error_network",
  invalid_contract: "connected_error_invalid_contract",
};

export default function ReconnectScreen({
  errorKind,
  errorDetail,
  onReconnect,
}: {
  errorKind?: ApiErrorKind;
  /** Field-level contract problems only (never tokens or customer data). */
  errorDetail?: string | null;
  onReconnect: (invoiceId: string, shortCode: string) => void;
}) {
  const t = useT();
  const [invoiceId, setInvoiceId] = useState("");
  const [shortCode, setShortCode] = useState("");

  return (
    <div
      style={{
        margin: 16,
        padding: 16,
        borderRadius: 14,
        background: "#fffbeb",
        border: "1px solid #fcd34d",
        maxWidth: 480,
      }}
    >
      {errorKind && (
        <div style={{ marginBottom: 10, color: "#92400e", fontSize: 13 }}>
          {t(ERROR_KEY_BY_KIND[errorKind]) || "The session link could not be used."}
          {errorKind === "invalid_contract" && errorDetail && (
            <div style={{ marginTop: 6, fontFamily: "monospace", fontSize: 12, wordBreak: "break-word" }}>{errorDetail}</div>
          )}
        </div>
      )}
      <h3 style={{ marginTop: 0 }}>{t("connected_reconnect_title") || "Reconnect to this invoice"}</h3>
      <div style={{ display: "grid", gap: 8 }}>
        <input
          placeholder={t("connected_reconnect_invoice_id") || "Invoice ID"}
          value={invoiceId}
          onChange={(e) => setInvoiceId(e.target.value)}
        />
        <input
          placeholder={t("connected_reconnect_short_code") || "Short code"}
          value={shortCode}
          onChange={(e) => setShortCode(e.target.value)}
        />
        <button
          type="button"
          disabled={!invoiceId.trim() || !shortCode.trim()}
          onClick={() => onReconnect(invoiceId.trim(), shortCode.trim())}
        >
          {t("connected_reconnect_submit") || "Reconnect"}
        </button>
      </div>
    </div>
  );
}
