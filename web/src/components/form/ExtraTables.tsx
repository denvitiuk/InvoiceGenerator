import React from "react";
import { useT } from "../../lib/i18n";
import { useStore } from "../../lib/store";
import {ExtraTable} from "../../../../server/types/invoice";


/**
 * ExtraTables — доп. таблицы к инвойсу.
 * Позволяет добавлять/удалять таблицы, колонки и строки, редактировать заголовки и ячейки, менять порядок.
 */
export default function ExtraTables() {
  const t = useT();
  const tables = useStore((s: any) => (s.invoice?.extraTables as ExtraTable[] | undefined) || []);
  const patchInvoice = useStore((s: any) => s.patchInvoice || s.setInvoice);

  function commit(next: ExtraTable[]) {
    if (typeof patchInvoice === "function") {
      try { patchInvoice({ extraTables: next }); return; } catch {}
    }
    console.warn("ExtraTables: please wire patchInvoice({ extraTables }) in the store");
  }

  function addTable() {
    const baseCols = ["", "", ""]; // пустые заголовки, чтобы не привязываться к языку
    const baseRows = [["", "", ""]];
    commit([ ...tables, { title: "", columns: baseCols, rows: baseRows } ]);
  }

  function removeTable(idx: number) {
    commit(tables.filter((_, i) => i !== idx));
  }

  function moveTable(idx: number, dir: -1 | 1) {
    const j = idx + dir; if (j < 0 || j >= tables.length) return;
    const next = tables.slice();
    const [x] = next.splice(idx, 1); next.splice(j, 0, x);
    commit(next);
  }

  function setTitle(idx: number, v: string) {
    const next = tables.map((tb, i) => i === idx ? { ...tb, title: v } : tb);
    commit(next);
  }

  function addCol(idx: number) {
    const tb = tables[idx];
    const cols = [...tb.columns, ""];
    const rows = tb.rows.map(r => [...r, ""]);
    const next = tables.map((t, i) => i === idx ? { ...t, columns: cols, rows } : t);
    commit(next);
  }

  function removeCol(idx: number, col: number) {
    const tb = tables[idx];
    if (tb.columns.length <= 1) return; // минимум 1 колонка
    const cols = tb.columns.filter((_, c) => c !== col);
    const rows = tb.rows.map(r => r.filter((_, c) => c !== col));
    const next = tables.map((t, i) => i === idx ? { ...t, columns: cols, rows } : t);
    commit(next);
  }

  function moveCol(idx: number, col: number, dir: -1 | 1) {
    const tb = tables[idx];
    const j = col + dir; if (j < 0 || j >= tb.columns.length) return;
    const cols = tb.columns.slice(); const [x] = cols.splice(col, 1); cols.splice(j, 0, x);
    const rows = tb.rows.map(r => { const rr = r.slice(); const [y] = rr.splice(col, 1); rr.splice(j, 0, y); return rr; });
    const next = tables.map((t, i) => i === idx ? { ...t, columns: cols, rows } : t);
    commit(next);
  }

  function setColName(idx: number, col: number, v: string) {
    const tb = tables[idx];
    const cols = tb.columns.map((c, i) => i === col ? v : c);
    const next = tables.map((t, i) => i === idx ? { ...t, columns: cols } : t);
    commit(next);
  }

  function addRow(idx: number) {
    const tb = tables[idx];
    const rows = [...tb.rows, new Array(tb.columns.length).fill("")];
    const next = tables.map((t, i) => i === idx ? { ...t, rows } : t);
    commit(next);
  }

  function removeRow(idx: number, row: number) {
    const tb = tables[idx];
    if (tb.rows.length <= 1) return; // минимум 1 строка
    const rows = tb.rows.filter((_, r) => r !== row);
    const next = tables.map((t, i) => i === idx ? { ...t, rows } : t);
    commit(next);
  }

  function moveRow(idx: number, row: number, dir: -1 | 1) {
    const tb = tables[idx];
    const j = row + dir; if (j < 0 || j >= tb.rows.length) return;
    const rows = tb.rows.slice(); const [x] = rows.splice(row, 1); rows.splice(j, 0, x);
    const next = tables.map((t, i) => i === idx ? { ...t, rows } : t);
    commit(next);
  }

  function setCell(idx: number, row: number, col: number, v: string) {
    const tb = tables[idx];
    const rows = tb.rows.map((rr, r) => r === row ? rr.map((c, i) => i === col ? v : c) : rr);
    const next = tables.map((t, i) => i === idx ? { ...t, rows } : t);
    commit(next);
  }

  return (
    <section className="fade-in">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h3>{t("section_extras")}</h3>
        <button data-variant="primary" onClick={addTable}>{t("add_table")}</button>
      </div>

      {tables.length === 0 && (
        <p className="muted" style={{ marginTop: 8 }}>
          No extra tables yet. Use "{t("add_table")}" to create one.
        </p>
      )}

      <div className="grid" style={{ marginTop: 8 }}>
        {tables.map((tb, idx) => (
          <div key={idx} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <input
                placeholder="Table title"
                value={tb.title || ""}
                onChange={(e) => setTitle(idx, e.target.value)}
              />
              <div className="row" style={{ gap: 6 }}>
                <button onClick={() => moveTable(idx, -1)} disabled={idx === 0} title="Move up">↑</button>
                <button onClick={() => moveTable(idx, +1)} disabled={idx === tables.length - 1} title="Move down">↓</button>
                <button onClick={() => removeTable(idx)} title={t("remove")}>{t("remove")}</button>
              </div>
            </div>

            {/* Header (columns) */}
            <div className="grid" style={{ gap: 6, marginBottom: 8 }}>
              <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {tb.columns.map((c, ci) => (
                  <div key={ci} className="row" style={{ gap: 6, alignItems: "center" }}>
                    <input
                      placeholder={`Col ${ci + 1}`}
                      value={c}
                      onChange={(e) => setColName(idx, ci, e.target.value)}
                      style={{ minWidth: 140 }}
                    />
                    <div className="row" style={{ gap: 4 }}>
                      <button onClick={() => moveCol(idx, ci, -1)} disabled={ci === 0} title="←">←</button>
                      <button onClick={() => moveCol(idx, ci, +1)} disabled={ci === tb.columns.length - 1} title="→">→</button>
                      <button onClick={() => removeCol(idx, ci)} title={t("remove")}>✕</button>
                    </div>
                  </div>
                ))}
                <button onClick={() => addCol(idx)}>{t("add_item").replace(/Item/i, "Col")}</button>
              </div>
            </div>

            {/* Body (rows) */}
            <div className="grid" style={{ gap: 6 }}>
              {tb.rows.map((r, ri) => (
                <div key={ri} className="row" style={{ gap: 6, alignItems: "stretch", flexWrap: "wrap" }}>
                  {r.map((val, ci) => (
                    <input
                      key={ci}
                      value={String(val ?? "")}
                      onChange={(e) => setCell(idx, ri, ci, e.target.value)}
                      placeholder={`R${ri + 1}C${ci + 1}`}
                      style={{ minWidth: 140, flex: "1 1 160px" }}
                    />
                  ))}
                  <div className="row" style={{ gap: 4 }}>
                    <button onClick={() => moveRow(idx, ri, -1)} disabled={ri === 0} title="↑">↑</button>
                    <button onClick={() => moveRow(idx, ri, +1)} disabled={ri === tb.rows.length - 1} title="↓">↓</button>
                    <button onClick={() => removeRow(idx, ri)} title={t("remove")}>✕</button>
                  </div>
                </div>
              ))}
              <button onClick={() => addRow(idx)}>{t("add_item").replace(/Item/i, "Row")}</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
