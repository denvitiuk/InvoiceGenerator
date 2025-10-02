

// Shared invoice types for the frontend (mirror of server/types/invoice.ts)
// If you change these, keep server/types/invoice.ts in sync.

export type Lang = "de" | "en" | "ru" | "bg" | "tr";

export type Currency = "EUR" | "USD" | "GBP";

export interface CompanyInfo {
  name: string;
  addressLines: string[];
  email?: string;
  phone?: string;
  website?: string;
  ustId?: string;
  steuerNr?: string;
  iban?: string;
  bic?: string;
  bankName?: string;
  logoPath?: string; // relative "/assets/..." or absolute file URL
}

export interface ClientInfo {
  name: string;
  addressLines: string[];
  ustId?: string;
}

export interface LineItem {
  description: string;
  qty: number;
  unit?: string;
  unitPrice: number; // net price per unit
  vatRate: number;   // e.g. 0, 7, 19
}

export interface ExtraTable {
  title?: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface ExtraImage {
  path: string;      // "/assets/uploads/..." from /upload or local file URL
  caption?: string;
  maxWidthPx?: number;
}

export interface InvoiceData {
  language?: Lang;   // language of the invoice output
  currency: Currency;
  number: string;    // invoice number (can be blank on create; server will assign)
  issueDateISO: string; // ISO date string
  servicePeriod?: { fromISO: string; toISO: string };
  dueDays?: number;        // payment term
  reverseCharge?: boolean; // Reverse-charge note
  kleinunternehmer?: boolean; // §19 UStG note
  notes?: string[];

  company: CompanyInfo;
  client: ClientInfo;
  items: LineItem[];

  extraTables?: ExtraTable[];
  extraImages?: ExtraImage[];
}

// ===== API request/response helpers for web/lib/api.ts =====
export interface PreviewRequest {
  language?: Lang;
  data: InvoiceData;
}

export type PreviewResponse = string; // HTML

export interface RenderRequest {
  language?: Lang; // optional override
  data: InvoiceData; // if number empty, server will generate
}

export interface RenderResponse {
  ok: boolean;
  file: string;   // absolute path on server
  name: string;   // filename suggested to user
  number: string; // resolved invoice number
  language: Lang;
}

export interface RenderAllRequest {
  languages?: Lang[]; // if missing and `all` not set, server uses data.language or default DE
  all?: boolean;      // render all supported languages
  zipName?: string;   // optional custom archive name
  data: InvoiceData;
}

export interface RenderAllResponse {
  ok: boolean;
  zip: string; // absolute path to zip on server
  files: { lang: Lang; name: string; path: string }[];
  number: string;
  languages: Lang[];
}

export interface UploadResponse {
  ok: boolean;
  path: string; // "/assets/uploads/…" to use in images or company.logoPath
  name: string;
  size: number;
  mimetype: string;
}