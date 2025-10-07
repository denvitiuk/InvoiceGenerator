// Frontend API helpers — talk to the backend via HTTP.
// In dev, Vite proxy should forward to :3001, but we also add a fallback
// directly to http://localhost:3001 to survive proxy misconfig.

import type {
  InvoiceData,
  Lang,
  RenderAllResponse,
  RenderResponse,
  UploadResponse,
} from "../../../server/types/invoice";

const DEV_BACKEND = "http://localhost:3001";
const API_BASE: string = ((import.meta as any)?.env?.VITE_API_BASE ?? "").trim(); // leave empty to use Vite proxy

function buildCandidates(path: string): string[] {
  const candidates: string[] = [];
  // 1) If API_BASE provided — use it. Otherwise, relative path (Vite proxy).
  candidates.push(API_BASE ? API_BASE + path : path);
  // 2) Dev fallback straight to backend (avoid duplicates)
  const fallback = DEV_BACKEND + path;
  if (!candidates.includes(fallback)) candidates.push(fallback);
  return candidates;
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
  return postJson<RenderAllResponse>("/render-all", { data, languages, all, zipName }, "json");
}

export async function renderAllBlob(
  data: InvoiceData,
  opts?: { languages?: Lang[]; all?: boolean; zipName?: string }
): Promise<{ blob: Blob; filename: string }> {
  const { languages, all, zipName } = opts || {};
  const { blob, filename } = await postBlob(`/render-all?download=1`, { data, languages, all, zipName });
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
