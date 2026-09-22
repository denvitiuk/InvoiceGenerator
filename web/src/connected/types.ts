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

export interface WorkPackageLineDTO {
  invoiceWorkItemId: string;
  workDate?: string;
  workType?: string;
  description?: string;
  workerCount: number;
  quantity: string;
  unit: string;
  unitPrice: string;
  vatRate: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  sortOrder: number;
  isExcluded: boolean;
  isOverridden: boolean;
  requiresReview: boolean;
}

export interface WorkPackageDTO {
  invoiceId: string;
  status: string;
  revision: number;
  billingProfileRef: string;
  projectId: number;
  projectName: string;
  projectLocation?: string;
  periodStart: string;
  periodEnd: string;
  issueDate?: string;
  dueDate?: string;
  currency: string;
  vatRate: string;
  timezone: string;
  aggregationMode: string;
  invoiceNumber?: string;
  automaticNetAmount: string;
  requiresReview: boolean;
  numberReservedAt?: string;
  lines: WorkPackageLineDTO[];
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
}

export interface ReserveInvoiceNumberRequest {
  expectedRevision: number;
  issueDate: string;
  dueDate: string;
}

export interface ReserveInvoiceNumberResponse {
  invoiceNumber: string;
  revision: number;
}

export interface FinalizeInvoiceRequest {
  expectedRevision: number;
  finalNetAmount: string;
  finalVatAmount: string;
  finalGrossAmount: string;
}

export interface FinalizeInvoiceResponse {
  invoiceNumber?: string;
  revision: number;
}
