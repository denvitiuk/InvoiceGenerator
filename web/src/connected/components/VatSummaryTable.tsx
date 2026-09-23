import React from "react";
import { useI18n } from "@/lib/i18n";
import { centsToNumber, formatRate } from "@/lib/invoiceTax";
import type { LineItem } from "@/types/invoice";
import { invoiceTaxSummary } from "../finalize/finalizeChecks";

const LOCALE: Record<string, string> = { de: "de-DE", en: "en-US", ru: "ru-RU", bg: "bg-BG", tr: "tr-TR", uk: "uk-UA" };

/**
 * Compact Netto / MwSt-per-rate / Gesamt MwSt / Gesamtbetrag summary, computed
 * with exactly the rules the PDF template uses (server lines verbatim).
 */
export default function VatSummaryTable({ items, currency }: { items: LineItem[]; currency: string }) {
  const { t, lang } = useI18n();
  const summary = invoiceTaxSummary(items);
  const money = (cents: number) =>
    new Intl.NumberFormat(LOCALE[lang] ?? "de-DE", { style: "currency", currency }).format(centsToNumber(cents));

  return (
    <div className="connected-vat-summary">
      <table>
        <tbody>
          <tr>
            <td>{t("connected_vat_net")}</td>
            <td className="num">{money(summary.netCents)}</td>
          </tr>
          {summary.groups.map((g) =>
            g.zeroRated ? (
              <tr key={`${g.taxCategory}|${g.taxExemptionReason}`} className="connected-muted">
                <td>
                  {t(`connected_tax_category_${g.taxCategory}`)} · {t("connected_vat_on")} {money(g.netCents)}
                </td>
                <td className="num">{money(0)}</td>
              </tr>
            ) : (
              <tr key={`${g.taxCategory}|${g.vatRate}`}>
                <td>
                  {t("connected_vat_rate_label", { rate: formatRate(g.vatRate) })}{" "}
                  <span className="connected-muted">
                    {t("connected_vat_on")} {money(g.netCents)}
                  </span>
                </td>
                <td className="num">{money(g.vatCents)}</td>
              </tr>
            )
          )}
          <tr>
            <td>{t("connected_vat_total")}</td>
            <td className="num">{money(summary.vatCents)}</td>
          </tr>
          <tr className="connected-vat-summary__grand">
            <td>{t("connected_vat_gross")}</td>
            <td className="num">{money(summary.grossCents)}</td>
          </tr>
        </tbody>
      </table>
      {summary.exemptionReasons.length > 0 && (
        <ul className="connected-vat-summary__reasons">
          {summary.exemptionReasons.map((r) => (
            <li key={`${r.taxCategory}|${r.reason}`}>
              <strong>{t(`connected_tax_category_${r.taxCategory}`)}:</strong> {r.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
