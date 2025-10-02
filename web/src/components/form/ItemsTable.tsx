

import React from "react";
import { useT } from "../../lib/i18n";
import { useStore } from "../../lib/store";
import {LineItem} from "../../../../server/types/invoice";

function r2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * ItemsTable — основная таблица позиций инвойса.
 * Редактирование полей, добавление/удаление/перемещение строк, лёгкие подсчёты по строке.
 */
export default function ItemsTable() {
  const t = useT();
  const items = useStore((s: any) => (s.invoice?.items as LineItem[] | undefined) || []);
  const currency = useStore((s: any) => s.invoice?.currency || "EUR");
  const patchInvoice = useStore((s: any) => s.patchInvoice || s.setInvoice);

  function commit(next: LineItem[]) {
    if (typeof patchInvoice === "function") {
      try { patchInvoice({ items: next }); return; } catch {}
    }
    console.warn("ItemsTable: please wire patchInvoice({ items }) in the store");
  }

  function addItem() {
    const base: LineItem = { description: "", qty: 1, unit: "", unitPrice: 0, vatRate: 0 };
    commit([...items, base]);
  }

  function removeAt(idx: number) {
    commit(items.filter((_, i) => i !== idx));
  }

  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    const [x] = next.splice(idx, 1);
    next.splice(j, 0, x);
    commit(next);
  }

  function update(idx: number, patch: Partial<LineItem>) {
    const next = items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
    commit(next);
  }

  const num = (v: string) => {
    if (v === "") return 0;
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };

  return (
    <section className="fade-in">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h3>{t("section_items")}</h3>
        <button data-variant="primary" onClick={addItem}>{t("add_item")}</button>
      </div>

      {items.length === 0 && (
        <p className="muted" style={{ marginTop: 8 }}>
          No items yet. Use "{t("add_item")}" to create one.
        </p>
      )}

      <div className="grid" style={{ gap: 10, marginTop: 8 }}>
        {items.map((it, idx) => {
          const net = r2((it.qty || 0) * (it.unitPrice || 0));
          const vat = r2(net * (it.vatRate || 0) / 100);
          const gross = r2(net + vat);
          return (
            <div key={idx} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
              <div className="grid" style={{ gridTemplateColumns: "1fr auto", gap: 8, alignItems: "start" }}>
                <input
                  placeholder={t("description")}
                  value={it.description || ""}
                  onChange={(e) => update(idx, { description: e.target.value })}
                />

                <div className="row" style={{ gap: 6 }}>
                  <button onClick={() => move(idx, -1)} disabled={idx === 0} title="Move up">↑</button>
                  <button onClick={() => move(idx, +1)} disabled={idx === items.length - 1} title="Move down">↓</button>
                  <button onClick={() => removeAt(idx)} title={t("remove")}>{t("remove")}</button>
                </div>
              </div>

              <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <label className="row" style={{ gap: 6 }}>
                  <span className="muted" style={{ minWidth: 86 }}>{t("unit")}</span>
                  <input
                    value={it.unit || ""}
                    onChange={(e) => update(idx, { unit: e.target.value })}
                    placeholder="h / pcs / m"
                    style={{ width: 120 }}
                  />
                </label>

                <label className="row" style={{ gap: 6 }}>
                  <span className="muted" style={{ minWidth: 86 }}>{t("qty")}</span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={it.qty ?? 0}
                    onChange={(e) => update(idx, { qty: num(e.target.value) })}
                    style={{ width: 120 }}
                  />
                </label>

                <label className="row" style={{ gap: 6 }}>
                  <span className="muted" style={{ minWidth: 86 }}>{t("unit_price")}</span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={it.unitPrice ?? 0}
                    onChange={(e) => update(idx, { unitPrice: num(e.target.value) })}
                    style={{ width: 160 }}
                  />
                </label>

                <label className="row" style={{ gap: 6 }}>
                  <span className="muted" style={{ minWidth: 86 }}>{t("vat_rate")}</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={it.vatRate ?? 0}
                    onChange={(e) => update(idx, { vatRate: num(e.target.value) })}
                    style={{ width: 120 }}
                  />
                </label>

                <div className="row" style={{ marginLeft: "auto", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="muted">NET</span>
                  <strong>{net.toFixed(2)} {currency}</strong>
                  <span className="muted">VAT</span>
                  <strong>{vat.toFixed(2)} {currency}</strong>
                  <span className="muted">GROSS</span>
                  <strong>{gross.toFixed(2)} {currency}</strong>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}