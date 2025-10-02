

import React from "react";
import { useT } from "../../lib/i18n";
import { useStore } from "../../lib/store";


/**
 * NotesBlock — свободные заметки внизу инвойса.
 * Хранится в invoice.notes: string[]
 */
export default function NotesBlock() {
  const t = useT();
  const notes = useStore((s: any) => (s.invoice?.notes as string[] | undefined) || []);
  const patchInvoice = useStore((s: any) => s.patchInvoice || s.setInvoice);

  function commit(next: string[]) {
    if (typeof patchInvoice === "function") {
      try { patchInvoice({ notes: next }); return; } catch {}
    }
    console.warn("NotesBlock: please wire patchInvoice({ notes }) in the store");
  }

  function addNote() {
    commit([ ...notes, "" ]);
  }

  function removeAt(idx: number) {
    commit(notes.filter((_, i) => i !== idx));
  }

  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir; if (j < 0 || j >= notes.length) return;
    const next = notes.slice(); const [x] = next.splice(idx, 1); next.splice(j, 0, x);
    commit(next);
  }

  function update(idx: number, v: string) {
    const next = notes.map((n, i) => i === idx ? v : n);
    commit(next);
  }

  return (
    <section className="fade-in">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h3>{t("section_notes")}</h3>
        <button data-variant="primary" onClick={addNote}>
          {t("add_item").replace(/Item/i, "Note")}
        </button>
      </div>

      {notes.length === 0 && (
        <p className="muted" style={{ marginTop: 8 }}>
          No notes yet. Use "{t("add_item").replace(/Item/i, "Note")}" to add one.
        </p>
      )}

      <div className="grid" style={{ gap: 10, marginTop: 8 }}>
        {notes.map((text, idx) => (
          <div key={idx} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <strong className="muted">Note {idx + 1}</strong>
              <div className="row" style={{ gap: 6 }}>
                <button onClick={() => move(idx, -1)} disabled={idx === 0} title="Move up">↑</button>
                <button onClick={() => move(idx, +1)} disabled={idx === notes.length - 1} title="Move down">↓</button>
                <button onClick={() => removeAt(idx)} title={t("remove")}>{t("remove")}</button>
              </div>
            </div>
            <textarea
              rows={3}
              value={text}
              onChange={(e) => update(idx, e.target.value)}
              placeholder="Enter your note…"
              style={{ width: "100%", resize: "vertical" }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}