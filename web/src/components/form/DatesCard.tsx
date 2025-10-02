

import React from "react";
import { useT } from "../../lib/i18n";
import { useStore } from "../../lib/store";
import {InvoiceData} from "../../../../server/types/invoice";


/**
 * DatesCard — блок управления датами: дата выставления, период услуги и срок оплаты (дни).
 * Хранение соответствует серверным типам: issueDateISO и servicePeriod {fromISO,toISO}.
 */
export default function DatesCard() {
  const t = useT();
  const invoice = useStore((s: any) => s.invoice as InvoiceData);
  const patchInvoice = useStore((s: any) => s.patchInvoice || s.setInvoice);

  const issueDateISO = invoice?.issueDateISO || "";
  const serviceFrom = invoice?.servicePeriod?.fromISO || "";
  const serviceTo = invoice?.servicePeriod?.toISO || "";
  const dueDays = typeof invoice?.dueDays === "number" ? invoice.dueDays : 0;

  function commit(next: Partial<InvoiceData>) {
    if (typeof patchInvoice === "function") {
      try { patchInvoice(next); return; } catch {}
    }
    console.warn("DatesCard: unknown store action; expected patchInvoice(partial)");
  }

  function setIssueDate(v: string) {
    commit({ issueDateISO: v || "" });
  }

  function setServicePeriod(patch: Partial<NonNullable<InvoiceData["servicePeriod"]>>) {
    const current = invoice?.servicePeriod || {};
    const merged = { ...current, ...patch } as NonNullable<InvoiceData["servicePeriod"]>;
    // если обе пустые — убираем объект, иначе сохраняем
    if (!merged.fromISO && !merged.toISO) {
      commit({ servicePeriod: undefined });
    } else {
      commit({ servicePeriod: merged });
    }
  }

  function setDueDays(v: string) {
    const n = Math.max(0, Number.isFinite(+v) ? parseInt(v, 10) : 0);
    commit({ dueDays: n });
  }

  return (
    <section className="fade-in">
      <h3>{t("section_dates")}</h3>
      <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        <div>
          <label className="row" style={{ gap: 8 }}>
            <span className="muted" style={{ minWidth: 92 }}>{t("issue_date")}</span>
            <input type="date" value={issueDateISO} onChange={(e) => setIssueDate(e.target.value)} />
          </label>
        </div>
        <div>
          <label className="row" style={{ gap: 8 }}>
            <span className="muted" style={{ minWidth: 92 }}>{t("service_from")}</span>
            <input type="date" value={serviceFrom} onChange={(e) => setServicePeriod({ fromISO: e.target.value })} />
          </label>
        </div>
        <div>
          <label className="row" style={{ gap: 8 }}>
            <span className="muted" style={{ minWidth: 92 }}>{t("service_to")}</span>
            <input type="date" value={serviceTo} onChange={(e) => setServicePeriod({ toISO: e.target.value })} />
          </label>
        </div>
        <div>
          <label className="row" style={{ gap: 8 }}>
            <span className="muted" style={{ minWidth: 92 }}>{t("due_days")}</span>
            <input type="number" min={0} step={1} value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
          </label>
        </div>
      </div>
    </section>
  );
}