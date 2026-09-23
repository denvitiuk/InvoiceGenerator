import React, { useState } from "react";
import { useT } from "@/lib/i18n";
import { isZeroRatedCategory, TAX_CATEGORIES } from "@/lib/invoiceTax";
import type { LineItem, TaxCategory } from "@/types/invoice";
import { manualLineTaxProblem, OPEN_STATUSES } from "../finalize/finalizeChecks";
import { defaultManualLineTax } from "../mapping/workPackageMapping";
import { useConnectedInvoiceStore } from "../store/connectedInvoiceStore";
import type { ConnectedSessionValue } from "../session/useConnectedSession";
import type { WorkPackageLineDTO } from "../types";

function ServerLineRow({
  line,
  readOnly,
  onCommit,
  onExclude,
}: {
  line: WorkPackageLineDTO;
  readOnly: boolean;
  onCommit: (patch: { description?: string; quantity?: number; unit?: string; unitPrice?: number }) => void;
  onExclude: () => void;
}) {
  const t = useT();
  const [description, setDescription] = useState(line.description || "");
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [unit, setUnit] = useState(line.unit || "");
  const [unitPrice, setUnitPrice] = useState(String(line.unitPrice));

  React.useEffect(() => {
    setDescription(line.description || "");
    setQuantity(String(line.quantity));
    setUnit(line.unit || "");
    setUnitPrice(String(line.unitPrice));
  }, [line.description, line.quantity, line.unit, line.unitPrice]);

  function commit() {
    onCommit({
      description,
      quantity: Number(quantity.replace(",", ".")) || 0,
      unit,
      unitPrice: Number(unitPrice.replace(",", ".")) || 0,
    });
  }

  return (
    <div className="invoice-item-card" style={line.requiresReview ? { borderColor: "#fdba74" } : undefined}>
      <div className="invoice-item-card__top">
        <div className="invoice-item-field invoice-item-field--description">
          <label>{t("description")}</label>
          <input value={description} disabled={readOnly} onChange={(e) => setDescription(e.target.value)} onBlur={commit} />
        </div>
        {!readOnly && (
          <button type="button" className="invoice-item-remove" onClick={onExclude}>
            {t("connected_item_exclude") || "Exclude"}
          </button>
        )}
      </div>
      <div className="invoice-item-card__values">
        <div className="invoice-item-field">
          <label>{t("qty")}</label>
          <input value={quantity} disabled={readOnly} onChange={(e) => setQuantity(e.target.value)} onBlur={commit} />
        </div>
        <div className="invoice-item-field">
          <label>{t("unit")}</label>
          <input value={unit} disabled={readOnly} onChange={(e) => setUnit(e.target.value)} onBlur={commit} />
        </div>
        <div className="invoice-item-field">
          <label>{t("unit_price")}</label>
          <input value={unitPrice} disabled={readOnly} onChange={(e) => setUnitPrice(e.target.value)} onBlur={commit} />
        </div>
        <div className="invoice-item-field">
          <label>{t("vat_rate")}</label>
          <input value={`${line.vatRate} % · ${t(`connected_tax_category_${line.taxCategory}`)}`} disabled />
        </div>
      </div>
      <div className="connected-line-amounts">
        <span>{t("connected_vat_net")} {line.netAmount}</span>
        <span>{t("connected_vat_amount")} {line.vatAmount}</span>
        <span>{t("connected_vat_gross")} {line.grossAmount}</span>
        {line.workerCount > 0 && <span>{t("connected_worker_count", { count: line.workerCount })}</span>}
      </div>
      {line.taxExemptionReason && (
        <div className="connected-muted" style={{ fontSize: 12, marginTop: 4 }}>
          {t("connected_tax_exemption_reason")}: {line.taxExemptionReason}
        </div>
      )}
      {line.requiresReview && (
        <div style={{ fontSize: 12, color: "#9a3412", marginTop: 4 }}>
          {t("connected_item_requires_review") || "Requires review"}
        </div>
      )}
    </div>
  );
}

function ManualLineRow({
  localId,
  item,
  readOnly,
  onChange,
  onRemove,
}: {
  localId: string;
  item: LineItem;
  readOnly: boolean;
  onChange: (patch: Partial<LineItem>) => void;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <div className="invoice-item-card">
      <div className="invoice-item-card__top">
        <div className="invoice-item-field invoice-item-field--description">
          <label>{t("description")}</label>
          <input
            value={item.description}
            disabled={readOnly}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </div>
        {!readOnly && (
          <button type="button" className="invoice-item-remove" onClick={onRemove}>
            {t("remove")}
          </button>
        )}
      </div>
      <div className="invoice-item-card__values">
        <div className="invoice-item-field">
          <label>{t("qty")}</label>
          <input
            value={String(item.qty)}
            disabled={readOnly}
            onChange={(e) => onChange({ qty: Number(e.target.value.replace(",", ".")) || 0 })}
          />
        </div>
        <div className="invoice-item-field">
          <label>{t("unit")}</label>
          <input value={item.unit || ""} disabled={readOnly} onChange={(e) => onChange({ unit: e.target.value })} />
        </div>
        <div className="invoice-item-field">
          <label>{t("unit_price")}</label>
          <input
            value={String(item.unitPrice)}
            disabled={readOnly}
            onChange={(e) => onChange({ unitPrice: Number(e.target.value.replace(",", ".")) || 0 })}
          />
        </div>
        <div className="invoice-item-field">
          <label>{t("vat_rate")}</label>
          <input
            value={String(item.vatRate)}
            disabled={readOnly || isZeroRatedCategory(item.taxCategory)}
            onChange={(e) => onChange({ vatRate: Number(e.target.value.replace(",", ".")) || 0 })}
          />
        </div>
        <div className="invoice-item-field">
          <label>{t("connected_tax_category")}</label>
          <select
            value={item.taxCategory ?? ""}
            disabled={readOnly}
            onChange={(e) => {
              const taxCategory = (e.target.value || undefined) as TaxCategory | undefined;
              onChange(
                isZeroRatedCategory(taxCategory)
                  ? { taxCategory, vatRate: 0 }
                  : { taxCategory, taxExemptionReason: undefined }
              );
            }}
          >
            <option value="">—</option>
            {TAX_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`connected_tax_category_${c}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {isZeroRatedCategory(item.taxCategory) && (
        <div className="invoice-item-field" style={{ marginTop: 6 }}>
          <label>{t("connected_tax_exemption_reason")}</label>
          <input
            value={item.taxExemptionReason ?? ""}
            disabled={readOnly}
            maxLength={500}
            placeholder={t("connected_tax_exemption_reason_placeholder")}
            onChange={(e) => onChange({ taxExemptionReason: e.target.value })}
          />
        </div>
      )}
      {manualLineTaxProblem(item) && (
        <div style={{ fontSize: 12, color: "#9a3412", marginTop: 4 }}>{t("connected_blocker_manual_line_tax_missing")}</div>
      )}
    </div>
  );
}

export default function ConnectedItemsSection({ session }: { session: ConnectedSessionValue }) {
  const t = useT();
  const manualLines = useConnectedInvoiceStore((s) => s.manualLines);
  const workPackage = session.workPackage;
  const readOnly = !session.state.context.permissions.edit || session.state.phase === "locked_finalized" || session.state.phase === "done";
  // The backend only accepts server-line edits in open statuses (not once a
  // number is reserved); manual rows stay editable until finalization.
  const serverReadOnly = readOnly || !OPEN_STATUSES.has(workPackage?.status ?? "");

  const activeLines = (workPackage?.items ?? []).filter((l) => !l.isExcluded);
  const excludedLines = (workPackage?.items ?? []).filter((l) => l.isExcluded);

  return (
    <section style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>{t("section_items")}</h3>

      {activeLines.map((line) => (
        <ServerLineRow
          key={line.invoiceWorkItemId}
          line={line}
          readOnly={serverReadOnly}
          onCommit={(patch) => void session.patchServerItem(line.invoiceWorkItemId, patch)}
          onExclude={() => void session.excludeServerItem(line.invoiceWorkItemId)}
        />
      ))}

      {manualLines.map(({ localId, item }) => (
        <ManualLineRow
          key={localId}
          localId={localId}
          item={item}
          readOnly={readOnly}
          onChange={(patch) => session.updateManualLine(localId, patch)}
          onRemove={() => session.removeManualLine(localId)}
        />
      ))}

      {!readOnly && (
        <button
          type="button"
          style={{ marginTop: 6 }}
          onClick={() => session.addManualLine({ description: "", qty: 1, unitPrice: 0, ...defaultManualLineTax(workPackage) })}
        >
          {t("add_item")}
        </button>
      )}

      {excludedLines.length > 0 && (
        <div style={{ marginTop: 16, opacity: 0.7 }}>
          <h4 style={{ fontSize: 13, marginBottom: 6 }}>{t("connected_excluded_items") || "Excluded items"}</h4>
          {excludedLines.map((line) => (
            <div key={line.invoiceWorkItemId} className="invoice-item-card" style={{ background: "#f8fafc" }}>
              <div className="invoice-item-card__top">
                <div className="invoice-item-field invoice-item-field--description">
                  <label>{t("description")}</label>
                  <div style={{ fontSize: 13 }}>{line.description || line.workType || line.invoiceWorkItemId}</div>
                </div>
                {!serverReadOnly && (
                  <button type="button" onClick={() => void session.includeServerItem(line.invoiceWorkItemId)}>
                    {t("connected_item_include") || "Include"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
