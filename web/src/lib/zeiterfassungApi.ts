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
  OverrideInvoiceNumberRequest,
  ReserveInvoiceNumberRequest,
  ReserveInvoiceNumberResponse,
  SaveEncryptedInvoiceDocumentRequest,
  SaveEncryptedVaultRequest,
  WorkPackageDTO,
} from "@/connected/types";
import { decodeWorkPackage, WorkPackageContractError } from "@/connected/mapping/workPackageDecoder";

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
  | "not_configured"
  | "invalid_contract";

export class EditorApiError extends Error {
  readonly status?: number;
  readonly kind: EditorApiErrorKind;
  /**
   * The backend's own `{"error": "..."}` message, when it sent one. Those
   * messages never carry tokens or PII (see the backend's HttpStatusException
   * call sites), so the UI may show them — e.g. "Invoice number already in use".
   */
  readonly serverMessage?: string;

  constructor(kind: EditorApiErrorKind, status?: number, message?: string, serverMessage?: string) {
    super(message || kind);
    this.name = "EditorApiError";
    this.kind = kind;
    this.status = status;
    this.serverMessage = serverMessage;
  }
}

function extractServerMessage(bodyText: string): string | undefined {
  try {
    const parsed = JSON.parse(bodyText);
    const msg = parsed && typeof parsed === "object" ? (parsed as { error?: unknown }).error : undefined;
    return typeof msg === "string" && msg.trim() ? msg.trim().slice(0, 300) : undefined;
  } catch {
    return undefined;
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
    throw new EditorApiError(
      kindForStatus(response.status),
      response.status,
      bodyText || response.statusText,
      extractServerMessage(bodyText)
    );
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

/** Every work-package response goes through the contract decoder — never used raw. */
function decodeOrThrow(raw: unknown): WorkPackageDTO {
  try {
    return decodeWorkPackage(raw);
  } catch (e) {
    if (e instanceof WorkPackageContractError) {
      throw new EditorApiError("invalid_contract", undefined, e.message, e.problems.slice(0, 5).join("; "));
    }
    throw e;
  }
}

export async function getWorkPackage(editorToken: string): Promise<WorkPackageDTO> {
  return decodeOrThrow(await request<unknown>("/invoicing/editor/work-package", { method: "GET", editorToken }));
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

export async function patchItem(
  editorToken: string,
  itemId: string,
  body: InvoiceItemOverrideRequest
): Promise<WorkPackageDTO> {
  return decodeOrThrow(
    await request<unknown>(`/invoicing/editor/items/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      editorToken,
    })
  );
}

export async function excludeItem(editorToken: string, itemId: string): Promise<WorkPackageDTO> {
  return decodeOrThrow(
    await request<unknown>(`/invoicing/editor/items/${encodeURIComponent(itemId)}/exclude`, {
      method: "POST",
      editorToken,
    })
  );
}

export async function includeItem(editorToken: string, itemId: string): Promise<WorkPackageDTO> {
  return decodeOrThrow(
    await request<unknown>(`/invoicing/editor/items/${encodeURIComponent(itemId)}/include`, {
      method: "POST",
      editorToken,
    })
  );
}

/**
 * A 2xx number response without an actual number/revision is never treated as
 * a reservation — the PDF must only ever carry a number the backend stored.
 */
function requireNumberResult(raw: unknown): ReserveInvoiceNumberResponse {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<ReserveInvoiceNumberResponse>;
  if (typeof o.invoiceNumber !== "string" || !o.invoiceNumber.trim() || !Number.isInteger(o.revision)) {
    throw new EditorApiError("invalid_contract", undefined, "Number response without invoiceNumber/revision");
  }
  return {
    invoiceNumber: o.invoiceNumber,
    revision: o.revision as number,
    status: typeof o.status === "string" ? o.status : "",
    issueDate: typeof o.issueDate === "string" ? o.issueDate : null,
    dueDate: typeof o.dueDate === "string" ? o.dueDate : null,
    invoiceNumberSource: o.invoiceNumberSource === "SEQUENCE" || o.invoiceNumberSource === "MANUAL" ? o.invoiceNumberSource : null,
    invoiceNumberPatternSnapshot: typeof o.invoiceNumberPatternSnapshot === "string" ? o.invoiceNumberPatternSnapshot : null,
  };
}

export async function reserveNumber(
  editorToken: string,
  body: ReserveInvoiceNumberRequest
): Promise<ReserveInvoiceNumberResponse> {
  return requireNumberResult(
    await request<unknown>("/invoicing/editor/number:reserve", {
      method: "POST",
      body: JSON.stringify(body),
      editorToken,
    })
  );
}

/**
 * Explicit manual invoice number (before finalization only). Revision-checked
 * and unique per company on the backend; any conflict is a 409, never a
 * silent success.
 */
export async function overrideNumber(
  editorToken: string,
  body: OverrideInvoiceNumberRequest
): Promise<ReserveInvoiceNumberResponse> {
  return requireNumberResult(
    await request<unknown>("/invoicing/editor/number:override", {
      method: "POST",
      body: JSON.stringify(body),
      editorToken,
    })
  );
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
