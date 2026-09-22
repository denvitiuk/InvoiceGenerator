import type { InvoiceData, LineItem } from "@/types/invoice";

export interface ManualLineRecord {
  localId: string;
  item: LineItem;
}

/**
 * Plaintext shape of the per-invoice encrypted document. `order` is the
 * combined display order across server + manual lines, keyed by
 * `srv:<invoiceWorkItemId>` / `local:<localId>` (see mapping/workPackageMapping.ts).
 */
export interface EncryptedDocumentPlaintext {
  schemaVersion: 1;
  invoiceDataSubset: Partial<InvoiceData>;
  manualLines: ManualLineRecord[];
  order: string[];
}

export function makeEmptyDocument(): EncryptedDocumentPlaintext {
  return {
    schemaVersion: 1,
    invoiceDataSubset: {},
    manualLines: [],
    order: [],
  };
}
