// Shared invoice types for the frontend (mirror of server/types/invoice.ts)
// If you change these, keep server/types/invoice.ts in sync.

export type Lang = "de" | "en" | "ru" | "bg" | "tr" | "uk";

export type Currency = "EUR" | "USD" | "GBP" | "UAH";

// Mirrors the backend's InvoiceTax.TaxCategory. EXEMPT, REVERSE_CHARGE and
// SMALL_BUSINESS are zero-rated: no VAT is charged and a legal reason is shown.
export type TaxCategory = "STANDARD" | "REDUCED" | "EXEMPT" | "REVERSE_CHARGE" | "SMALL_BUSINESS";

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
    logoPath?: string; // "/assets/..." from /upload (recommended) or absolute URL/data URL
    logoUrl?: string;  // optional external/logo URL (future-proof; normalized via fileUrl on server)
}

export interface ClientInfo {
    name: string;
    addressLines: string[];
    ustId?: string;
}

export type MonthlyCalculationMode = "weekdays" | "selected";

export interface MonthlyDailyEntry {
    date: string;
    people: number;
    hours: number; // hours per person
}

export interface MonthlyCalculation {
    month: string; // YYYY-MM
    mode: MonthlyCalculationMode;
    selectedDates: string[]; // ISO dates included in the calculation
    detailed?: boolean;
    dailyEntries?: MonthlyDailyEntry[];
}

export interface LineItem {
    group?: string; // optional object/project group shown as a heading above related items
    description: string;
    descriptionHtml?: string; // sanitized rich text; currently supports bold and line breaks
    monthlyCalculation?: MonthlyCalculation;
    qty: number;
    unit?: string;
    unitPrice: number; // net price per unit
    vatRate: number;   // e.g. 0, 7, 19

    // Connected-invoice mode only: links this row back to a backend
    // invoiceWorkItemId (absent for manual/local rows). Internal metadata —
    // never rendered into the PDF/DOCX output and stripped before a row is
    // ever saved into a reusable plaintext template.
    serverItemId?: string;
    serverExcluded?: boolean;

    // Connected-invoice mode only. Server lines carry the backend's tax
    // classification and amounts (plain decimal strings, e.g. "34.20"), which
    // the template renders verbatim instead of recomputing. Manual rows leave
    // the amounts unset and are computed locally (2-decimal half-up rounding).
    taxCategory?: TaxCategory;
    taxExemptionReason?: string;
    netAmount?: string;
    vatAmount?: string;
    grossAmount?: string;
    workerCount?: number;

    // Backend preview (POST /invoicing/invoices/{id}/preview) only: raw facts of
    // an automatic line. The template localizes them into the description
    // (date + "N Personen · X h gesamt") in the document language, exactly like
    // the connected UI does via enrichLineDescription(). Absent everywhere else.
    serverDetails?: { workDateISO?: string; workerCount?: number };
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

export interface ThemeColors {
    primary: string;     // main brand color
    secondary: string;   // secondary brand color
    accent: string;      // highlights/badges

    text: string;        // main text color
    mutedText: string;   // secondary text

    background: string;  // page background
    surface: string;     // cards/boxes/table headers
    border: string;      // borders/dividers

    gradientFrom?: string; // optional header gradient start
    gradientTo?: string;   // optional header gradient end
}

export type LogoAlign = "left" | "center" | "right";

export type InvoiceThemeLayout = {
    roundness: number; // 0..24 px
    logoAlign?: LogoAlign;
    logoHeight?: number; // px
};

export interface InvoiceTheme {
    colors: ThemeColors;
    layout?: InvoiceThemeLayout;
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
    theme?: InvoiceTheme;

    company: CompanyInfo;
    client: ClientInfo;
    object?: string; // optional object / project / site reference
    items: LineItem[];

    extraTables?: ExtraTable[];
    extraImages?: ExtraImage[];
    documentTitle?: string;
    showNumberInTitle?: boolean;
    fileName?: string;
    numberingMode?: "auto" | "manual";

    // Connected-invoice mode only: the backend's due date (ISO) and the
    // customer number from the work package's customer snapshot.
    dueDateISO?: string;
    customerNumber?: string;

    // Backend preview only: the invoice is an unnumbered draft. The template
    // shows a localized draft watermark/notice and never a fake line.
    draft?: boolean;
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
    path: string; // "/assets/uploads/..." to use in extraImages[].path or company.logoPath
    name: string;
    size: number;
    mimetype: string;
}

export type NumberingMode = "auto" | "manual";
