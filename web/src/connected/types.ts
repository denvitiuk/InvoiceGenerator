// Hand-typed mirrors of the zeiterfassung-server DTOs consumed by connected mode
// (source of truth: InvoicingDto.kt / InvoicingEditorRoutes.kt in that repo).
// Money/quantity fields stay `string` here, exactly as the backend sends them —
// conversion to `number` happens only at the InvoiceData mapping boundary
// (see mapping/money.ts), so no precision is lost before that point.

export interface EditorPermissionsDTO {
  read: boolean;
  edit: boolean;
  finalize: boolean;
}

export interface EditorExchangeRequest {
  invoiceId?: string;
  token?: string;
  shortCode?: string;
}

export interface EditorExchangeResponse {
  editorAccessToken: string;
  invoiceId: string;
  accessExpiresAt: string;
  permissions: EditorPermissionsDTO;
}

export type TaxCategoryDTO = "STANDARD" | "REDUCED" | "EXEMPT" | "REVERSE_CHARGE" | "SMALL_BUSINESS";

export type InvoiceNumberSourceDTO = "SEQUENCE" | "MANUAL";

// Nullable fields below are sent explicitly as `null` by the backend (its
// WorkPackageDTO has no defaults, see InvoicingDto.kt) — they are never
// optional/omitted. decodeWorkPackage() (mapping/workPackageDecoder.ts)
// enforces this shape at the API boundary.
export interface WorkPackageLineDTO {
  invoiceWorkItemId: string;
  workDate: string | null;
  workType: string | null;
  description: string | null;
  workerCount: number;
  quantity: string;
  unit: string;
  unitPrice: string;
  vatRate: string;
  taxCategory: TaxCategoryDTO;
  taxExemptionReason: string | null;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  sortOrder: number;
  isExcluded: boolean;
  isOverridden: boolean;
  requiresReview: boolean;
}

export interface InvoiceTotalsDTO {
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
}

export interface VatSummaryEntryDTO {
  vatRate: string;
  taxCategory: TaxCategoryDTO;
  taxExemptionReason: string | null;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
}

/** Safe customer metadata only — full legal details live in the encrypted vault. */
export interface InvoiceCustomerSnapshotDTO {
  invoiceCustomerId: string;
  customerNumber: string | null;
  displayName: string | null;
}

export interface WorkPackageDTO {
  invoiceId: string;
  invoiceNumber: string | null;
  status: string;
  revision: number;

  issueDate: string | null;
  dueDate: string | null;
  currency: string;

  invoiceCustomerId: string | null;
  billingProfileRef: string;
  customer: InvoiceCustomerSnapshotDTO | null;

  invoiceNumberSource: InvoiceNumberSourceDTO | null;
  invoiceNumberPatternSnapshot: string | null;

  projectId: number;
  projectName: string;
  projectLocation: string | null;
  periodStart: string;
  periodEnd: string;

  vatRate: string;
  timezone: string;
  aggregationMode: string;
  automaticNetAmount: string;
  requiresReview: boolean;
  numberReservedAt: string | null;

  /** Every line incl. excluded ones. Primary field; always set after decoding. */
  items: WorkPackageLineDTO[];
  /** Deprecated backend alias of `items`; only read as a fallback by the decoder. */
  lines?: WorkPackageLineDTO[];

  /** Cover only non-excluded lines. */
  totals: InvoiceTotalsDTO;
  vatSummary: VatSummaryEntryDTO[];
}

export interface EncryptedVaultDTO {
  companyId: number;
  revision: number;
  profileVersion: number;
  cipherAlgorithm: string;
  encryptedPayloadBase64: string;
  payloadNonceBase64: string;
  ciphertextSha256Base64: string;
  updatedAt: string;
}

export interface SaveEncryptedVaultRequest {
  expectedRevision: number;
  profileVersion: number;
  cipherAlgorithm?: string;
  encryptedPayloadBase64: string;
  payloadNonceBase64: string;
  ciphertextSha256Base64: string;
}

export interface EncryptedInvoiceDocumentDTO {
  invoiceId: string;
  revision: number;
  vaultProfileVersion: number;
  encryptionKeyVersion: number;
  cipherAlgorithm: string;
  wrappedDocumentKeyBase64: string;
  documentKeyNonceBase64: string;
  documentCiphertextBase64: string;
  documentNonceBase64: string;
  documentSha256Base64: string;
  hasPdf: boolean;
  pdfSizeBytes?: number;
  updatedAt: string;
}

export interface SaveEncryptedInvoiceDocumentRequest {
  expectedRevision: number;
  vaultProfileVersion: number;
  encryptionKeyVersion?: number;
  cipherAlgorithm?: string;
  wrappedDocumentKeyBase64: string;
  documentKeyNonceBase64: string;
  documentCiphertextBase64: string;
  documentNonceBase64: string;
  documentSha256Base64: string;
  pdfCiphertextBase64?: string;
  pdfStorageKey?: string;
  pdfNonceBase64?: string;
  pdfSha256Base64?: string;
  pdfSizeBytes?: number;
}

export interface InvoiceItemOverrideRequest {
  description?: string;
  workType?: string;
  quantity?: string;
  unit?: string;
  unitPrice?: string;
  netAmount?: string;
  vatRate?: string;
  taxCategory?: TaxCategoryDTO;
  taxExemptionReason?: string;
}

export interface ReserveInvoiceNumberRequest {
  expectedRevision: number;
  // Optional: the backend defaults issueDate to today (invoice timezone) and
  // dueDate to issueDate + the company's payment terms.
  issueDate?: string;
  dueDate?: string;
}

/** Returned by both number:reserve and number:override — the number actually stored by the backend. */
export interface ReserveInvoiceNumberResponse {
  invoiceNumber: string;
  revision: number;
  status: string;
  issueDate: string | null;
  dueDate: string | null;
  invoiceNumberSource: InvoiceNumberSourceDTO | null;
  invoiceNumberPatternSnapshot: string | null;
}

export interface OverrideInvoiceNumberRequest {
  expectedRevision: number;
  invoiceNumber: string;
  issueDate?: string;
  dueDate?: string;
}

export interface FinalizeInvoiceRequest {
  expectedRevision: number;
  finalNetAmount: string;
  finalVatAmount: string;
  finalGrossAmount: string;
}

export interface FinalizeInvoiceResponse {
  invoiceNumber: string | null;
  revision: number;
}
