

import React, { useRef, useState } from "react";
import { uploadFile } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { useStore } from "../../lib/store";
import {ExtraImage} from "../../../../server/types/invoice";


/**
 * ImagesBlock — управление дополнительными изображениями инвойса (не логотип).
 * Позволяет загружать картинки через /upload, задавать подпись и максимальную ширину, удалять и менять порядок.
 *
 * Примечание: стор может иметь разные экшены. Мы пытаемся использовать `patchInvoice`,
 * а если его нет — `setInvoice`. Оба вызываем в формате (partial) extraImages.
 */
export default function ImagesBlock() {
  const t = useT();

  // Достаём массив изображений из стора (если нет — подставим пустой)
  const images = useStore((s: any) => (s.invoice?.extraImages as ExtraImage[] | undefined) || []);
  const patchInvoice = useStore((s: any) => s.patchInvoice || s.setInvoice);

  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function commit(next: ExtraImage[]) {
    if (typeof patchInvoice === "function") {
      // большинство сторах имеет сигнатуру patchInvoice(partial)
      try {
        patchInvoice({ extraImages: next });
        return;
      } catch (_) {
        // fallback: возможно сеттер принимает целый объект invoice
      }
    }
    // Фолбэк — если экшен не подошёл, попробуем через setState-стиль
    console.warn("ImagesBlock: unknown store action; please wire patchInvoice to accept { extraImages }");
  }

  async function onUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    try {
      const resp = await uploadFile(f);
      const next: ExtraImage[] = [...images, { path: resp.path, caption: "", maxWidthPx: 600 }];
      commit(next);
    } catch (err: any) {
      alert(err?.message || "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = ""; // чтобы можно было выбрать тот же файл ещё раз
    }
  }

  function update(idx: number, patch: Partial<ExtraImage>) {
    const next = images.map((img, i) => (i === idx ? { ...img, ...patch } : img));
    commit(next);
  }

  function removeAt(idx: number) {
    const next = images.filter((_, i) => i !== idx);
    commit(next);
  }

  function move(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= images.length) return;
    const next = images.slice();
    const [x] = next.splice(idx, 1);
    next.splice(j, 0, x);
    commit(next);
  }

  return (
    <section className="fade-in">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h3>{t("section_images")}</h3>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.svg,.pdf"
            style={{ display: "none" }}
            onChange={onUploadFile}
          />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} data-variant="primary">
            {uploading ? "…" : t("add_image")}
          </button>
        </div>
      </div>

      {images.length === 0 && (
        <p className="muted" style={{ marginTop: 8 }}>
          No images yet. Use "{t("add_image")}" to upload.
        </p>
      )}

      <div className="grid" style={{ marginTop: 8 }}>
        {images.map((img, idx) => (
          <div key={idx} style={{ display: "grid", gridTemplateColumns: "140px 1fr auto", gap: 12, alignItems: "start", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, padding: 12 }}>
            <div className="preview" style={{ overflow: "hidden", borderRadius: 8, border: "1px solid var(--border)", background: "#fff" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.path} alt={img.caption || `image-${idx}`} style={{ display: "block", width: "100%", height: 100, objectFit: "contain" }} />
            </div>
            <div className="grid">
              <div className="row" style={{ gap: 8 }}>
                <input
                  placeholder="Caption"
                  value={img.caption || ""}
                  onChange={(e) => update(idx, { caption: e.target.value })}
                />
                <input
                  type="number"
                  placeholder="Max width (px)"
                  min={100}
                  step={10}
                  value={img.maxWidthPx ?? 600}
                  onChange={(e) => update(idx, { maxWidthPx: Number(e.target.value || 0) })}
                  style={{ maxWidth: 180 }}
                />
              </div>
              <input
                placeholder="/assets/uploads/... or URL"
                value={img.path}
                onChange={(e) => update(idx, { path: e.target.value })}
              />
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button onClick={() => move(idx, -1)} disabled={idx === 0} title="Move up">↑</button>
              <button onClick={() => move(idx, +1)} disabled={idx === images.length - 1} title="Move down">↓</button>
              <button onClick={() => removeAt(idx)} title={t("remove")}>{t("remove")}</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}