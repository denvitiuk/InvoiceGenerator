import React from "react";
import { useT } from "@/lib/i18n";
import { calcTotals } from "@/lib/store";
import type { ConnectedSessionValue } from "../session/useConnectedSession";

const PROGRESS_PHASES = [
  "reserving",
  "preview_settling",
  "rendering_pdf",
  "uploading_pdf",
  "finalizing",
] as const;

const FAILED_PHASES = ["reserve_failed", "render_failed", "upload_failed", "finalize_failed"] as const;

const PROGRESS_LABEL_KEY: Record<string, string> = {
  reserving: "connected_status_reserving",
  preview_settling: "connected_status_preview_settling",
  rendering_pdf: "connected_status_rendering_pdf",
  uploading_pdf: "connected_status_uploading_pdf",
  finalizing: "connected_status_finalizing",
  reserve_failed: "connected_status_reserve_failed",
  render_failed: "connected_status_render_failed",
  upload_failed: "connected_status_upload_failed",
  finalize_failed: "connected_status_finalize_failed",
};

export default function FinalizeDialog({
  session,
  onClose,
}: {
  session: ConnectedSessionValue;
  onClose: () => void;
}) {
  const t = useT();
  const { state, editor, workPackage } = session;
  const totals = calcTotals(editor.invoice);
  const inProgress = (PROGRESS_PHASES as readonly string[]).includes(state.phase);
  const failed = (FAILED_PHASES as readonly string[]).includes(state.phase);
  const done = state.phase === "done";

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !inProgress) onClose();
      }}
    >
      <div style={{ background: "#fff", borderRadius: 16, padding: 20, maxWidth: 420, width: "90%" }}>
        <h3 style={{ marginTop: 0 }}>{t("connected_finalize_dialog_title") || "Confirm invoice"}</h3>

        {!inProgress && !done && !failed && (
          <>
            <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 14 }}>
              <dt>{t("connected_finalize_object") || "Object"}</dt>
              <dd>{editor.invoice.object || "—"}</dd>
              <dt>{t("connected_finalize_period") || "Period"}</dt>
              <dd>
                {workPackage?.periodStart} – {workPackage?.periodEnd}
              </dd>
              <dt>{t("connected_finalize_number") || "Number"}</dt>
              <dd>{editor.invoice.number || t("connected_finalize_number_pending") || "assigned on confirm"}</dd>
              <dt>{t("connected_finalize_net") || "Net"}</dt>
              <dd>{totals.subtotalNet.toFixed(2)} {editor.invoice.currency}</dd>
              <dt>{t("connected_finalize_vat") || "VAT"}</dt>
              <dd>{totals.vatTotal.toFixed(2)} {editor.invoice.currency}</dd>
              <dt>{t("connected_finalize_gross") || "Gross"}</dt>
              <dd>
                <strong>
                  {totals.grand.toFixed(2)} {editor.invoice.currency}
                </strong>
              </dd>
            </dl>
            <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={onClose}>
                {t("cancel") || "Cancel"}
              </button>
              <button type="button" onClick={() => void session.startFinalize()} data-variant="primary">
                {t("connected_finalize_cta") || "Проверить и подтвердить счёт"}
              </button>
            </div>
          </>
        )}

        {inProgress && (
          <div style={{ fontSize: 14 }}>{t(PROGRESS_LABEL_KEY[state.phase]) || state.phase}</div>
        )}

        {failed && (
          <div>
            <div style={{ fontSize: 14, color: "#b91c1c", marginBottom: 10 }}>
              {t(PROGRESS_LABEL_KEY[state.phase]) || state.phase}
            </div>
            <button type="button" onClick={() => void session.retryAfterFailure()}>
              {t("connected_retry") || "Retry"}
            </button>
          </div>
        )}

        {done && (
          <div>
            <div style={{ fontSize: 14, color: "#166534", marginBottom: 10 }}>
              {t("connected_finalize_done") || "Invoice confirmed."}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={session.downloadFinalPdf} data-variant="primary">
                {t("connected_download_pdf") || "Download PDF"}
              </button>
              <button type="button" onClick={onClose}>
                {t("close") || "Close"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
