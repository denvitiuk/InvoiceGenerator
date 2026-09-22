// Client for the zeiterfassung-server "Invoice Generator hand-off" API
// (`NEXT_PUBLIC_ZEITERFASSUNG_API_BASE`). Deliberately independent of
// `src/lib/api.ts` — that module talks to this generator's own same-origin
// `/api/*` routes (preview/render/upload) and has legacy-path fallback logic
// that has nothing to do with this cross-origin, token-authenticated API.
//
// Every editor-session call sends `X-Editor-Token` as a header, never a query
// string, and never a JWT. Every call throws a typed `EditorApiError` so
// callers can branch on the exact failure per the connected-mode spec (401,
// 403, 404, 409, 429, 5xx, and network errors are all handled distinctly —
// none of them may be treated as success).

import type {
  EditorExchangeRequest,
  EditorExchangeResponse,
  EncryptedInvoiceDocumentDTO,
  EncryptedVaultDTO,
  FinalizeInvoiceRequest,
  FinalizeInvoiceResponse,
  InvoiceItemOverrideRequest,
  ReserveInvoiceNumberRequest,
  ReserveInvoiceNumberResponse,
  SaveEncryptedInvoiceDocumentRequest,
  SaveEncryptedVaultRequest,
  WorkPackageDTO,
} from "@/connected/types";

const API_BASE: string = (process.env.NEXT_PUBLIC_ZEITERFASSUNG_API_BASE || "").trim().replace(/\/+$/, "");
const EDITOR_TOKEN_HEADER = "X-Editor-Token";

export type EditorApiErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "not_configured";

export class EditorApiError extends Error {
  readonly status?: number;
  readonly kind: EditorApiErrorKind;

  constructor(kind: EditorApiErrorKind, status?: number, message?: string) {
    super(message || kind);
    this.name = "EditorApiError";
    this.kind = kind;
    this.status = status;
  }
}

function kindForStatus(status: number): EditorApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  return "server_error";
}

function url(path: string): string {
  if (!API_BASE) {
    throw new EditorApiError("not_configured", undefined, "NEXT_PUBLIC_ZEITERFASSUNG_API_BASE is not set");
  }
  return `${API_BASE}${path}`;
}

async function request<T>(
  path: string,
  init: RequestInit & { editorToken?: string }
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.editorToken) headers[EDITOR_TOKEN_HEADER] = init.editorToken;

  const target = url(path); // throws EditorApiError("not_configured") synchronously — kept outside the try below

  let response: Response;
  try {
    response = await fetch(target, { ...init, headers });
  } catch {
    throw new EditorApiError("network_error", undefined, "Network request failed");
  }

  if (!response.ok) {
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      // ignore
    }
    throw new EditorApiError(kindForStatus(response.status), response.status, bodyText || response.statusText);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function exchangeToken(body: EditorExchangeRequest): Promise<EditorExchangeResponse> {
  return request<EditorExchangeResponse>("/invoicing/editor/exchange", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getWorkPackage(editorToken: string): Promise<WorkPackageDTO> {
  return request<WorkPackageDTO>("/invoicing/editor/work-package", { method: "GET", editorToken });
}

export async function getVault(editorToken: string): Promise<EncryptedVaultDTO | null> {
  try {
    return await request<EncryptedVaultDTO>("/invoicing/editor/vault", { method: "GET", editorToken });
  } catch (e) {
    if (e instanceof EditorApiError && e.kind === "not_found") return null;
    throw e;
  }
}

export function saveVault(
  editorToken: string,
  body: SaveEncryptedVaultRequest
): Promise<EncryptedVaultDTO> {
  return request<EncryptedVaultDTO>("/invoicing/editor/vault", {
    method: "PUT",
    body: JSON.stringify(body),
    editorToken,
  });
}

export async function getDocument(editorToken: string): Promise<EncryptedInvoiceDocumentDTO | null> {
  try {
    return await request<EncryptedInvoiceDocumentDTO>("/invoicing/editor/document", {
      method: "GET",
      editorToken,
    });
  } catch (e) {
    if (e instanceof EditorApiError && e.kind === "not_found") return null;
    throw e;
  }
}

export function saveDocument(
  editorToken: string,
  body: SaveEncryptedInvoiceDocumentRequest
): Promise<EncryptedInvoiceDocumentDTO> {
  return request<EncryptedInvoiceDocumentDTO>("/invoicing/editor/document", {
    method: "PUT",
    body: JSON.stringify(body),
    editorToken,
  });
}

export function patchItem(
  editorToken: string,
  itemId: string,
  body: InvoiceItemOverrideRequest
): Promise<WorkPackageDTO> {
  return request<WorkPackageDTO>(`/invoicing/editor/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    editorToken,
  });
}

export function excludeItem(editorToken: string, itemId: string): Promise<WorkPackageDTO> {
  return request<WorkPackageDTO>(`/invoicing/editor/items/${encodeURIComponent(itemId)}/exclude`, {
    method: "POST",
    editorToken,
  });
}

export function includeItem(editorToken: string, itemId: string): Promise<WorkPackageDTO> {
  return request<WorkPackageDTO>(`/invoicing/editor/items/${encodeURIComponent(itemId)}/include`, {
    method: "POST",
    editorToken,
  });
}

export function reserveNumber(
  editorToken: string,
  body: ReserveInvoiceNumberRequest
): Promise<ReserveInvoiceNumberResponse> {
  return request<ReserveInvoiceNumberResponse>("/invoicing/editor/number:reserve", {
    method: "POST",
    body: JSON.stringify(body),
    editorToken,
  });
}

export function finalizeInvoice(
  editorToken: string,
  body: FinalizeInvoiceRequest
): Promise<FinalizeInvoiceResponse> {
  return request<FinalizeInvoiceResponse>("/invoicing/editor/finalize", {
    method: "POST",
    body: JSON.stringify(body),
    editorToken,
  });
}
