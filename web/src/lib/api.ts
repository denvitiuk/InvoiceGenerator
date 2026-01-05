// Frontend API helpers — talk to the backend via Next.js API routes.
// We intentionally use same-origin `/api/*` endpoints (no separate Express server).


import {InvoiceData, RenderAllResponse, RenderResponse, UploadResponse} from "@/types/invoice";

export type Lang = "en" | "de" | "ru" | "bg" | "tr" | "uk";

// Optional override (useful for self-hosting behind a different domain).
// In Next, only NEXT_PUBLIC_* is exposed to the browser.
const API_BASE: string = (process.env.NEXT_PUBLIC_API_BASE || "").trim();

function normalizeApiPath(p: string): string {
  const path = p.startsWith("/") ? p : `/${p}`;

  // If caller already passed /api/..., keep it.
  if (path.startsWith("/api/")) {
    // Special-case: some legacy code may call `/api/render-all`.
    if (path === "/api/render-all" || path.startsWith("/api/render-all?")) return "/api/renderAll";
    return path;
  }

  // Special-case: legacy endpoint used by the UI: `/render-all`.
  // Our Next API file is `pages/api/renderAll.ts` (camelCase), so the runtime route is `/api/renderAll`.
  if (path === "/render-all" || path.startsWith("/render-all?")) return "/api/renderAll";

  // Otherwise rewrite old legacy endpoints (/render, /preview, ...) to /api/...
  return `/api${path}`;
}

function buildCandidates(path: string): string[] {
  const p = normalizeApiPath(path);
  // 1) If API_BASE provided — use it. Otherwise, same-origin relative path.
  return [API_BASE ? API_BASE + p : p];
}

async function apiFetch(path: string, init: RequestInit): Promise<Response> {
  let lastText = "";
  for (const url of buildCandidates(path)) {
    try {
      const resp = await fetch(url, init);
      if (resp.ok) return resp;
      // If it's a 404 (likely Vite), try next candidate
      if (resp.status === 404) {
        lastText = await resp.text().catch(() => "");
        continue;
      }
      const text = await resp.text().catch(() => "");
      throw new Error(`${resp.status} ${resp.statusText}${text ? `: ${text}` : ""}`);
    } catch (e: any) {
      lastText = e?.message || String(e);
      // Try next candidate
    }
  }
  throw new Error(`404 Not Found: ${path}${lastText ? ` — ${lastText}` : ""}`);
}

async function postJson<T>(path: string, body: unknown, as: "json" | "text" = "json"): Promise<T> {
  const resp = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return (as === "text" ? (await resp.text()) : (await resp.json())) as T;
}

function filenameFromContentDisposition(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  // RFC 5987 (filename*=UTF-8'') has priority
  const mStar = /filename\*=UTF-8''([^;]+)/i.exec(v);
  if (mStar && mStar[1]) {
    try {
      return decodeURIComponent(mStar[1]);
    } catch {}
  }
  const m = /filename\s*=\s*"?([^";]+)"?/i.exec(v);
  return m && m[1] ? m[1] : undefined;
}

async function postBlob(path: string, body: unknown): Promise<{ blob: Blob; filename?: string }> {
  const resp = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const cd = resp.headers.get("Content-Disposition");
  const filename = filenameFromContentDisposition(cd);
  const blob = await resp.blob();
  return { blob, filename };
}

export async function previewInvoice(data: InvoiceData, language?: Lang): Promise<string> {
  return postJson<string>("/preview", { data, language }, "text");
}

export async function previewInvoicePdf(data: InvoiceData, language?: Lang): Promise<Blob> {
  const resp = await apiFetch("/preview-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, language }),
  });
  return await resp.blob();
}

export async function renderInvoice(data: InvoiceData, language?: Lang): Promise<RenderResponse> {
  // pass optional custom filename from the invoice (server will sanitize and apply if provided)
  const fileName = (data as any)?.fileName || undefined;
  return postJson<RenderResponse>("/render", { data, language, fileName }, "json");
}

export async function renderInvoiceBlob(
  data: InvoiceData,
  language?: Lang
): Promise<{ blob: Blob; filename: string }> {
  const fileName = (data as any)?.fileName || undefined;
  const { blob, filename } = await postBlob(`/render?download=1`, { data, language, fileName });
  const fallback = `${`rechnung-${data.number}`}${language ? `-${language}` : ""}.pdf`;
  return {
    blob,
    filename: filename || (fileName ? (fileName.endsWith(".pdf") ? fileName : fileName + ".pdf") : fallback),
  };
}

export async function renderAll(
  data: InvoiceData,
  opts?: { languages?: Lang[]; all?: boolean; zipName?: string }
): Promise<RenderAllResponse> {
  const { languages, all, zipName } = opts || {};
  return postJson<RenderAllResponse>("/api/renderAll", { data, languages, all, zipName }, "json");
}

export async function renderAllBlob(
  data: InvoiceData,
  opts?: { languages?: Lang[]; all?: boolean; zipName?: string }
): Promise<{ blob: Blob; filename: string }> {
  const { languages, all, zipName } = opts || {};
  const { blob, filename } = await postBlob(`/api/renderAll?download=1`, { data, languages, all, zipName });
  const fallback = `rechnung-${data.number}-bundle.zip`;
  return {
    blob,
    filename: filename || (zipName ? (zipName.endsWith(".zip") ? zipName : zipName + ".zip") : fallback),
  };
}

export async function uploadFile(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const resp = await apiFetch("/upload", { method: "POST", body: form });
  return (await resp.json()) as UploadResponse;
}

export function openInNewTab(html: string) {
  const w = window.open("", "_blank");
  if (!w) throw new Error("Popup blocked");
  w.document.open();
  w.document.write(html);
  w.document.close();
}
