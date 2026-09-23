import React, { useState } from "react";
import { useT } from "@/lib/i18n";
import { isNumberEditable } from "../finalize/finalizeChecks";
import type { ConnectedSessionValue, OverrideNumberResult } from "../session/useConnectedSession";

const OVERRIDE_ERROR_KEY: Record<Exclude<OverrideNumberResult, { ok: true }>["reason"], string> = {
  busy: "connected_number_override_busy",
  no_permission: "connected_number_override_no_permission",
  immutable: "connected_number_override_immutable",
  invalid_format: "connected_number_override_invalid",
  conflict: "connected_number_override_conflict",
  session_expired: "connected_error_unauthorized",
  failed: "connected_number_override_failed",
};

/**
 * The number is only ever set by the backend: automatically at confirmation
 * (number:reserve) or through the explicit "change number" action
 * (number:override). Nothing here computes or stores a number locally.
 */
export default function ConnectedNumberField({ session }: { session: ConnectedSessionValue }) {
  const t = useT();
  const { workPackage, state } = session;
  const number = session.editor.invoice.number;
  const source = workPackage?.invoiceNumberSource ?? null;

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const editable =
    Boolean(workPackage) &&
    isNumberEditable(workPackage?.status) &&
    state.context.permissions.finalize &&
    state.phase === "loaded_editing";

  function openForm() {
    setDraft(number || "");
    setError(null);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (session.overrideInFlight) return;
    setError(null);
    const result = await session.overrideInvoiceNumber(draft);
    if (result.ok) {
      setOpen(false);
      return;
    }
    const message = t(OVERRIDE_ERROR_KEY[result.reason]);
    setError(result.serverMessage ? `${message} (${result.serverMessage})` : message);
  }

  return (
    <div className="connected-number">
      <div className="connected-number__head">
        <label>{t("connected_number_label")}</label>
        {number && (
          <span className={`connected-pill ${source === "MANUAL" ? "connected-pill--warn" : "connected-pill--info"}`}>
            {source === "MANUAL" ? t("connected_number_source_manual") : t("connected_number_source_automatic")}
          </span>
        )}
      </div>

      <div className="connected-number__row">
        <div
          className={`connected-number__value${number ? "" : " connected-number__value--pending"}`}
          title={number ? undefined : t("connected_number_readonly_hint")}
          data-testid="connected-number-value"
        >
          {number || t("connected_number_pending")}
        </div>
        {editable && !open && (
          <button type="button" className="connected-link-button" onClick={openForm}>
            {t("connected_number_change")}
          </button>
        )}
      </div>

      {open && (
        <form className="connected-number__form" onSubmit={submit}>
          <div className="connected-number__current">
            {t("connected_number_current")}: <strong>{number || t("connected_number_pending")}</strong>
            {!number && workPackage?.invoiceNumberPatternSnapshot && (
              <span className="connected-muted"> · {t("connected_number_pattern")}: {workPackage.invoiceNumberPatternSnapshot}</span>
            )}
          </div>
          <label htmlFor="connected-number-input">{t("connected_number_custom")}</label>
          <input
            id="connected-number-input"
            value={draft}
            maxLength={64}
            autoFocus
            autoComplete="off"
            placeholder="RE-2026-0042"
            onChange={(e) => setDraft(e.target.value)}
            disabled={session.overrideInFlight}
          />
          <div className="connected-muted connected-number__hint">{t("connected_number_override_hint")}</div>
          {error && (
            <div role="alert" className="connected-error">
              {error}
            </div>
          )}
          <div className="connected-number__actions">
            <button type="button" onClick={() => setOpen(false)} disabled={session.overrideInFlight}>
              {t("cancel")}
            </button>
            <button type="submit" data-variant="primary" disabled={session.overrideInFlight || !draft.trim()}>
              {session.overrideInFlight ? t("connected_number_override_saving") : t("connected_number_override_confirm")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
