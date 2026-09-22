import React from "react";
import { useT } from "@/lib/i18n";

export default function SessionExpiredScreen({ onOpenReconnect }: { onOpenReconnect: () => void }) {
  const t = useT();
  return (
    <div
      style={{
        margin: 16,
        padding: 16,
        borderRadius: 14,
        background: "#fef2f2",
        border: "1px solid #fca5a5",
        color: "#7f1d1d",
        maxWidth: 480,
      }}
    >
      <h3 style={{ marginTop: 0 }}>{t("connected_session_expired_title") || "Editor session expired"}</h3>
      <p>{t("connected_session_expired_body") || "Your editing session has expired. Reconnect using the invoice ID and short code to continue."}</p>
      <button type="button" onClick={onOpenReconnect}>
        {t("connected_session_expired_reconnect") || "Reconnect"}
      </button>
    </div>
  );
}
