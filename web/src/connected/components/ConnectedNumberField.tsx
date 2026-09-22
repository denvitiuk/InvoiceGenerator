import React from "react";
import { useT } from "@/lib/i18n";
import type { ConnectedSessionValue } from "../session/useConnectedSession";

/** Fully read-only in connected mode — the number is only ever set by the server's reserve step. */
export default function ConnectedNumberField({ session }: { session: ConnectedSessionValue }) {
  const t = useT();
  const number = session.editor.invoice.number;
  return (
    <div>
      <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("number") || "Number"}</label>
      <div
        style={{
          width: "100%",
          padding: "8px 10px",
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          background: "#f8fafc",
          color: number ? undefined : "#94a3b8",
          fontSize: 14,
        }}
        title={t("connected_number_readonly_hint") || "Assigned automatically when you confirm the invoice"}
      >
        {number || t("connected_number_pending") || "Assigned on confirm"}
      </div>
    </div>
  );
}
