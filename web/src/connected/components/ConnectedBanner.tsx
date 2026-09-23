import React, { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import type { ConnectedSessionValue } from "../session/useConnectedSession";
import ReconnectScreen from "./ReconnectScreen";
import SessionExpiredScreen from "./SessionExpiredScreen";
import UnsupportedBrowserNotice from "./UnsupportedBrowserNotice";
import VaultUnavailableNotice from "./VaultUnavailableNotice";
import RecipientProfilePrompt from "./RecipientProfilePrompt";
import RequiresReviewBanner from "./RequiresReviewBanner";
import FinalizeDialog from "./FinalizeDialog";

const SAVE_STATE_KEY: Record<string, string> = {
  idle: "connected_save_state_idle",
  saving: "connected_save_state_saving",
  saved: "connected_save_state_saved",
  offline: "connected_save_state_offline",
  conflict: "connected_save_state_conflict",
  error: "connected_save_state_error",
};

function formatCountdown(expiresAtISO: string | null): string | null {
  if (!expiresAtISO) return null;
  const ms = new Date(expiresAtISO).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function ConnectedBanner({ session }: { session: ConnectedSessionValue }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  const [finalizeOpen, setFinalizeOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { state, workPackage, saveState, accessExpiresAt, loading } = session;
  void now; // triggers a re-render every second for the countdown

  if (loading) {
    return (
      <div style={bannerStyle}>
        <span>{t("connected_loading") || "Connecting…"}</span>
      </div>
    );
  }

  if (state.phase === "unsupported_browser") {
    return <UnsupportedBrowserNotice />;
  }

  if (state.phase === "exchange_error" || state.phase === "awaiting_reconnect") {
    return <ReconnectScreen errorKind={state.errorKind} errorDetail={session.loadErrorDetail} onReconnect={session.reconnect} />;
  }

  if (state.phase === "session_expired") {
    return <SessionExpiredScreen onOpenReconnect={session.openReconnect} />;
  }

  if (state.phase === "vault_unavailable") {
    return <VaultUnavailableNotice onCreateNewProfile={session.createNewLocalProfile} />;
  }

  // Opens the review dialog; everything that still blocks confirmation is
  // listed there (and the confirm button stays disabled) instead of hiding it.
  const canFinalize = state.context.permissions.finalize && state.phase === "loaded_editing";
  const customer = workPackage?.customer;
  const numberSource = workPackage?.invoiceNumberSource;
  const invoiceNumber = session.editor.invoice.number;
  const objectLabel = [workPackage?.projectName, workPackage?.projectLocation].filter(Boolean).join(" — ");

  return (
    <div style={bannerStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div className="connected-banner__facts">
          <div className="connected-banner__fact">
            <span className="connected-banner__label">{t("connected_finalize_object")}</span>
            <strong>{objectLabel || t("connected_banner_title")}</strong>
            <span className="connected-muted">
              {workPackage?.periodStart} – {workPackage?.periodEnd}
            </span>
          </div>
          <div className="connected-banner__fact">
            <span className="connected-banner__label">{t("connected_customer")}</span>
            <strong>{customer?.displayName || t("connected_customer_unknown")}</strong>
            {customer?.customerNumber && (
              <span className="connected-muted">
                {t("connected_customer_number")} {customer.customerNumber}
              </span>
            )}
          </div>
          <div className="connected-banner__fact">
            <span className="connected-banner__label">{t("connected_number_label")}</span>
            <strong data-testid="connected-banner-number">{invoiceNumber || t("connected_number_pending")}</strong>
            {invoiceNumber && (
              <span className={`connected-pill ${numberSource === "MANUAL" ? "connected-pill--warn" : "connected-pill--info"}`}>
                {numberSource === "MANUAL" ? t("connected_number_source_manual") : t("connected_number_source_automatic")}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
          {state.phase === "locked_finalized" || state.phase === "done" ? (
            <span style={pillStyle("#dcfce7", "#166534")}>{t("connected_status_finalized") || "Finalized"}</span>
          ) : (
            <span style={pillStyle("#e0e7ff", "#3730a3")}>{t(SAVE_STATE_KEY[saveState]) || saveState}</span>
          )}
          {accessExpiresAt && (
            <span title={t("connected_session_expires_hint") || "Editor session time remaining"}>
              ⏱ {formatCountdown(accessExpiresAt)}
            </span>
          )}
          {canFinalize && (
            <button type="button" data-variant="primary" onClick={() => setFinalizeOpen(true)}>
              {t("connected_finalize_cta") || "Проверить и подтвердить счёт"}
            </button>
          )}
        </div>
      </div>

      <RequiresReviewBanner workPackage={workPackage} />

      {!session.hasProfileForBillingRef && state.phase !== "locked_finalized" && state.phase !== "done" && (
        <RecipientProfilePrompt session={session} />
      )}

      {(state.phase === "conflict" || state.phase === "offline") && (
        <div style={{ marginTop: 8, fontSize: 13 }}>
          {state.phase === "conflict"
            ? t("connected_conflict_notice") || "Someone else saved changes to this invoice. Reload to see the latest version before continuing."
            : t("connected_offline_notice") || "You appear to be offline. Changes will retry automatically."}
        </div>
      )}

      {finalizeOpen && <FinalizeDialog session={session} onClose={() => setFinalizeOpen(false)} />}
    </div>
  );
}

const bannerStyle: React.CSSProperties = {
  padding: "10px 16px",
  borderBottom: "1px solid #e5e7eb",
  background: "#f8fafc",
};

function pillStyle(bg: string, color: string): React.CSSProperties {
  return {
    background: bg,
    color,
    borderRadius: 999,
    padding: "2px 10px",
    fontWeight: 600,
  };
}
