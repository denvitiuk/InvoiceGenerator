// Frontend API helpers — talk to the backend via HTTP.
// In dev, Vite proxy forwards "/preview|render|render-all|upload|presets" to :3001.



import type {
  InvoiceData,
  Lang,
  RenderAllResponse,
  RenderResponse,
  UploadResponse,
} from "../../../server/types/invoice";



const API_BASE = (import.meta as any)?.env?.VITE_API_BASE || ""; // leave empty to use Vite proxy

async function postJson<T>(path: string, body: unknown, as: "json" | "text" = "json"): Promise<T> {
  const resp = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${resp.status} ${resp.statusText}${text ? `: ${text}` : ""}`);
  }
  return (as === "text" ? (await resp.text()) : (await resp.json())) as T;
}

export async function previewInvoice(data: InvoiceData, language?: Lang): Promise<string> {
  return postJson<string>("/preview", { data, language }, "text");
}

export async function previewInvoicePdf(data: InvoiceData, language?: Lang): Promise<Blob> {
  const resp = await fetch(API_BASE + "/preview-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data, language }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${resp.status} ${resp.statusText}${text ? `: ${text}` : ""}`);
  }
  return await resp.blob();
}

export async function renderInvoice(data: InvoiceData, language?: Lang): Promise<RenderResponse> {
  return postJson<RenderResponse>("/render", { data, language }, "json");
}

export async function renderAll(
  data: InvoiceData,
  opts?: { languages?: Lang[]; all?: boolean; zipName?: string }
): Promise<RenderAllResponse> {
  const { languages, all, zipName } = opts || {};
  return postJson<RenderAllResponse>("/render-all", { data, languages, all, zipName }, "json");
}

export async function uploadFile(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const resp = await fetch(API_BASE + "/upload", { method: "POST", body: form });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${resp.status} ${resp.statusText}${text ? `: ${text}` : ""}`);
  }
  return (await resp.json()) as UploadResponse;
}

export function openInNewTab(html: string) {
  const w = window.open("", "_blank");
  if (!w) throw new Error("Popup blocked");
  w.document.open();
  w.document.write(html);
  w.document.close();
}
