import React, { useState } from "react";
import { useT } from "@/lib/i18n";
import type { FinalizeBlocker } from "../finalize/finalizeChecks";
import type { ConnectedSessionValue, FlowError } from "../session/useConnectedSession";
import VatSummaryTable from "./VatSummaryTable";

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

export const BLOCKER_KEY: Record<FinalizeBlocker, string> = {
  no_permission: "connected_blocker_no_permission",
  status_immutable: "connected_blocker_status_immutable",
  requires_review: "connected_blocker_requires_review",
  recipient_profile_missing: "connected_blocker_recipient_profile_missing",
  recipient_name_missing: "connected_blocker_recipient_name_missing",
  recipient_address_missing: "connected_blocker_recipient_address_missing",
  server_totals_inconsistent: "connected_blocker_server_totals_inconsistent",
  manual_line_tax_missing: "connected_blocker_manual_line_tax_missing",
};

const FLOW_ERROR_KEY: Record<string, string> = {
  unauthorized: "connected_error_unauthorized",
  forbidden: "connected_error_forbidden",
  not_found: "connected_error_not_found",
  conflict: "connected_error_conflict",
  rate_limited: "connected_error_rate_limited",
  server_error: "connected_error_server",
  network_error: "connected_error_network",
  invalid_contract: "connected_error_invalid_contract",
  number_missing: "connected_error_number_missing",
};

function formatDate(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function FlowErrorMessage({ error }: { error: FlowError | null }) {
  const t = useT();
  if (!error || error.kind === "blocked") return null;
  return (
    <div className="connected-muted" style={{ fontSize: 12, marginTop: 4 }}>
      {t(FLOW_ERROR_KEY[error.kind] ?? "connected_error_server")}
      {error.serverMessage ? ` (${error.serverMessage})` : ""}
    </div>
  );
}

export default function FinalizeDialog({
  session,
  onClose,
}: {
  session: ConnectedSessionValue;
  onClose: () => void;
}) {
  const t = useT();
  const { state, editor, workPackage, finalizeBlockers, flowError } = session;
  const invoice = editor.invoice;
  const inProgress = (PROGRESS_PHASES as readonly string[]).includes(state.phase);
  const failed = (FAILED_PHASES as readonly string[]).includes(state.phase);
  const done = state.phase === "done";
  // Local latch in addition to the session's own in-flight guard: the button
  // is disabled from the very first click, before the phase has changed.
  const [submitting, setSubmitting] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const blocked = finalizeBlockers.length > 0;
  const numberSource = workPackage?.invoiceNumberSource;

  async function confirm() {
    if (submitting || blocked) return;
    setSubmitting(true);
    try {
      await session.startFinalize();
    } finally {
      setSubmitting(false);
    }
  }

  async function retry() {
    if (retrying) return;
    setRetrying(true);
    try {
      await session.retryAfterFailure();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="connected-finalize-title"
      className="connected-dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !inProgress && !submitting) onClose();
      }}
    >
      <div className="connected-dialog">
        <h3 id="connected-finalize-title" style={{ marginTop: 0 }}>
          {t("connected_finalize_dialog_title")}
        </h3>

        <dl className="connected-review-grid">
          <dt>{t("connected_finalize_number")}</dt>
          <dd>
            <strong>{invoice.number || t("connected_number_pending")}</strong>
            {invoice.number && (
              <span className={`connected-pill ${numberSource === "MANUAL" ? "connected-pill--warn" : "connected-pill--info"}`} style={{ marginLeft: 8 }}>
                {numberSource === "MANUAL" ? t("connected_number_source_manual") : t("connected_number_source_automatic")}
              </span>
            )}
          </dd>
          <dt>{t("connected_customer")}</dt>
          <dd>
            {workPackage?.customer?.displayName || invoice.client.name || "—"}
            {workPackage?.customer?.customerNumber && (
              <span className="connected-muted"> · {t("connected_customer_number")} {workPackage.customer.customerNumber}</span>
            )}
          </dd>
          <dt>{t("connected_recipient")}</dt>
          <dd>
            {invoice.client.name || "—"}
            {invoice.client.addressLines.filter(Boolean).length > 0 && (
              <div className="connected-muted">{invoice.client.addressLines.filter(Boolean).join(", ")}</div>
            )}
          </dd>
          <dt>{t("connected_finalize_object")}</dt>
          <dd>{invoice.object || "—"}</dd>
          <dt>{t("connected_finalize_period")}</dt>
          <dd>
            {formatDate(workPackage?.periodStart)} – {formatDate(workPackage?.periodEnd)}
          </dd>
          <dt>{t("connected_issue_date")}</dt>
          <dd>{formatDate(invoice.issueDateISO) === "—" ? t("connected_issue_date_on_confirm") : formatDate(invoice.issueDateISO)}</dd>
          <dt>{t("connected_due_date")}</dt>
          <dd>
            {formatDate(invoice.dueDateISO)}
            {invoice.dueDays !== undefined && <span className="connected-muted"> · {t("connected_due_days", { days: invoice.dueDays })}</span>}
          </dd>
        </dl>

        <VatSummaryTable items={invoice.items} currency={invoice.currency} />

        {blocked && !inProgress && !done && (
          <div role="alert" className="connected-callout connected-callout--warn">
            <strong>{t("connected_blockers_title")}</strong>
            <ul>
              {finalizeBlockers.map((b) => (
                <li key={b}>{t(BLOCKER_KEY[b])}</li>
              ))}
            </ul>
          </div>
        )}

        {!inProgress && !done && !failed && (
          <div className="connected-dialog__actions">
            <button type="button" onClick={onClose} disabled={submitting}>
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              data-variant="primary"
              disabled={submitting || blocked || state.phase !== "loaded_editing"}
            >
              {invoice.number ? t("connected_finalize_confirm_reserved") : t("connected_finalize_confirm")}
            </button>
          </div>
        )}

        {inProgress && (
          <div className="connected-callout" aria-live="polite">
            {t(PROGRESS_LABEL_KEY[state.phase]) || state.phase}
          </div>
        )}

        {failed && (
          <div className="connected-callout connected-callout--error" role="alert">
            <div>{t(PROGRESS_LABEL_KEY[state.phase]) || state.phase}</div>
            <FlowErrorMessage error={flowError} />
            <div className="connected-dialog__actions">
              <button type="button" onClick={onClose} disabled={retrying}>
                {t("close")}
              </button>
              <button type="button" data-variant="primary" onClick={() => void retry()} disabled={retrying}>
                {t("connected_retry")}
              </button>
            </div>
          </div>
        )}

        {done && (
          <div className="connected-callout connected-callout--ok">
            <div>{t("connected_finalize_done")}</div>
            <div className="connected-dialog__actions">
              <button type="button" onClick={session.downloadFinalPdf} data-variant="primary">
                {t("connected_download_pdf")}
              </button>
              <button type="button" onClick={onClose}>
                {t("close")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
