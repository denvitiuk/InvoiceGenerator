

import React from "react";
import { useT } from "../../lib/i18n";
import { useStore } from "../../lib/store";
import {Currency, InvoiceData} from "../../../../server/types/invoice";


/**
 * OptionsBlock — общие параметры счёта:
 * - валюта
 * - номер счёта
 * - reverse charge / §19 UStG
 * - статус (draft/paid/unpaid)
 * - (опционально) водяной знак — если хочешь, можно включить, но по умолчанию скрыт
 */
export default function OptionsBlock() {
  const t = useT();
  const invoice = useStore((s: any) => s.invoice as InvoiceData);
  const patchInvoice = useStore((s: any) => s.patchInvoice || s.setInvoice);

  const currency = (invoice?.currency || "EUR") as Currency;
  const number = invoice?.number || "";
  const reverseCharge = Boolean((invoice as any)?.reverseCharge);
  const kleinunternehmer = Boolean((invoice as any)?.kleinunternehmer);
  const status = ((invoice as any)?.status || "draft") as "draft" | "paid" | "unpaid";
  const watermark = (invoice as any)?.watermark as string | undefined; // опционально

  function commit(patch: Partial<InvoiceData> & Record<string, unknown>) {
    if (typeof patchInvoice === "function") {
      try { patchInvoice(patch); return; } catch {}
    }
    console.warn("OptionsBlock: please wire patchInvoice(partial) in the store");
  }

  function setCurrency(v: string) {
    commit({ currency: (v as Currency) });
  }

  function setNumber(v: string) {
    commit({ number: v });
  }

  function setReverseCharge(v: boolean) {
    commit({ reverseCharge: v } as any);
  }

  function setKleinunternehmer(v: boolean) {
    commit({ kleinunternehmer: v } as any);
  }

  function setStatus(v: "draft" | "paid" | "unpaid") {
    commit({ status: v } as any);
  }

  function setWatermark(v: string) {
    commit({ watermark: v } as any);
  }

  return (
    <section className="fade-in">
      <h3>{t("section_options")}</h3>

      <div className="grid" style={{ gap: 10, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        {/* Currency */}
        <label className="row" style={{ gap: 8, alignItems: "center" }}>
          <span className="muted" style={{ minWidth: 120 }}>{t("currency")}</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
            <option value="GBP">GBP</option>
          </select>
        </label>

        {/* Number */}
        <label className="row" style={{ gap: 8, alignItems: "center" }}>
          <span className="muted" style={{ minWidth: 120 }}>{t("number")}</span>
          <input
            placeholder="2025-001"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
        </label>

        {/* Reverse-charge */}
        <label className="row" style={{ gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={reverseCharge} onChange={(e) => setReverseCharge(e.target.checked)} />
          <span>{t("reverse_charge")}</span>
        </label>

        {/* §19 UStG */}
        <label className="row" style={{ gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={kleinunternehmer} onChange={(e) => setKleinunternehmer(e.target.checked)} />
          <span>{t("kleinunternehmer")}</span>
        </label>

        {/* Status */}
        <label className="row" style={{ gap: 8, alignItems: "center" }}>
          <span className="muted" style={{ minWidth: 120 }}>{t("status")}</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="draft">{t("status_draft")}</option>
            <option value="paid">{t("status_paid")}</option>
            <option value="unpaid">{t("status_unpaid")}</option>
          </select>
        </label>

        {/* Watermark — опционально. Если на сервере и шаблоне не используется, можешь скрыть. */}
        <label className="row" style={{ gap: 8, alignItems: "center" }}>
          <span className="muted" style={{ minWidth: 120 }}>{t("watermark")}</span>
          <input
            placeholder="CONFIDENTIAL / PAID / DRAFT"
            value={watermark || ""}
            onChange={(e) => setWatermark(e.target.value)}
          />
        </label>
      </div>

      {/* Подсказки */}
      {kleinunternehmer && (
        <p className="muted" style={{ marginTop: 6 }}>
          §19 UStG выбран: проверь ставки НДС в позициях (обычно 0%).
        </p>
      )}
      {reverseCharge && (
        <p className="muted" style={{ marginTop: 6 }}>
          Reverse charge: убедись, что у клиента и компании указаны корректные VAT ID.
        </p>
      )}
    </section>
  );
}