// Test-only fixtures mirroring the backend's WorkPackageDTO contract
// (zeiterfassung-server InvoicingDto.kt). Not imported by application code.

import type { InvoiceVault } from "../vault/vaultTypes";
import type { EncryptedVaultDTO, WorkPackageDTO, WorkPackageLineDTO } from "../types";

export function makeLine(overrides: Partial<WorkPackageLineDTO> = {}): WorkPackageLineDTO {
  return {
    invoiceWorkItemId: "line-1",
    workDate: "2026-09-01",
    workType: "Reinigung",
    description: "Unterhaltsreinigung",
    workerCount: 3,
    quantity: "12",
    unit: "h",
    unitPrice: "15.00",
    vatRate: "19.00",
    taxCategory: "STANDARD",
    taxExemptionReason: null,
    netAmount: "180.00",
    vatAmount: "34.20",
    grossAmount: "214.20",
    sortOrder: 0,
    isExcluded: false,
    isOverridden: false,
    requiresReview: false,
    ...overrides,
  };
}

/** Single 19 % line: 180.00 + 34.20 = 214.20. */
export function makeWorkPackage(overrides: Partial<WorkPackageDTO> = {}): WorkPackageDTO {
  const items = overrides.items ?? [makeLine()];
  return {
    invoiceId: "inv-1",
    invoiceNumber: null,
    status: "EDITING",
    revision: 5,
    issueDate: null,
    dueDate: null,
    currency: "EUR",
    invoiceCustomerId: "cust-1",
    billingProfileRef: "profile-1",
    customer: { invoiceCustomerId: "cust-1", customerNumber: "K-1001", displayName: "Hausverwaltung Nord GmbH" },
    invoiceNumberSource: null,
    invoiceNumberPatternSnapshot: null,
    projectId: 42,
    projectName: "Wohnanlage Lindenhof",
    projectLocation: "Hamburg",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    vatRate: "19.00",
    timezone: "Europe/Berlin",
    aggregationMode: "BY_DAY",
    automaticNetAmount: "180.00",
    requiresReview: false,
    numberReservedAt: null,
    totals: { netAmount: "180.00", vatAmount: "34.20", grossAmount: "214.20" },
    vatSummary: [
      {
        vatRate: "19.00",
        taxCategory: "STANDARD",
        taxExemptionReason: null,
        netAmount: "180.00",
        vatAmount: "34.20",
        grossAmount: "214.20",
      },
    ],
    ...overrides,
    items,
    lines: overrides.lines ?? items,
  };
}

export const REVERSE_CHARGE_REASON = "Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG)";

/** 180.00 @ 19 % + 100.00 @ 7 % + 40.00 reverse charge = 320.00 net, 41.20 VAT, 361.20 gross. */
export function makeMixedVatWorkPackage(overrides: Partial<WorkPackageDTO> = {}): WorkPackageDTO {
  const items = [
    makeLine(),
    makeLine({
      invoiceWorkItemId: "line-2",
      workType: "Material",
      description: "Reinigungsmittel",
      workerCount: 0,
      quantity: "4",
      unit: "Stk",
      unitPrice: "25.00",
      vatRate: "7.00",
      taxCategory: "REDUCED",
      netAmount: "100.00",
      vatAmount: "7.00",
      grossAmount: "107.00",
      sortOrder: 1,
    }),
    makeLine({
      invoiceWorkItemId: "line-3",
      workType: "Subunternehmer",
      description: "Glasreinigung Fassade",
      workerCount: 1,
      quantity: "1",
      unit: "pauschal",
      unitPrice: "40.00",
      vatRate: "0.00",
      taxCategory: "REVERSE_CHARGE",
      taxExemptionReason: REVERSE_CHARGE_REASON,
      netAmount: "40.00",
      vatAmount: "0.00",
      grossAmount: "40.00",
      sortOrder: 2,
    }),
  ];
  return makeWorkPackage({
    automaticNetAmount: "320.00",
    items,
    totals: { netAmount: "320.00", vatAmount: "41.20", grossAmount: "361.20" },
    vatSummary: [
      { vatRate: "19.00", taxCategory: "STANDARD", taxExemptionReason: null, netAmount: "180.00", vatAmount: "34.20", grossAmount: "214.20" },
      { vatRate: "7.00", taxCategory: "REDUCED", taxExemptionReason: null, netAmount: "100.00", vatAmount: "7.00", grossAmount: "107.00" },
      { vatRate: "0.00", taxCategory: "REVERSE_CHARGE", taxExemptionReason: REVERSE_CHARGE_REASON, netAmount: "40.00", vatAmount: "0.00", grossAmount: "40.00" },
    ],
    ...overrides,
  });
}

export function makeVault(profiles: InvoiceVault["profiles"]): InvoiceVault {
  return {
    schemaVersion: 1,
    company: { name: "Glanz & Co. Gebäudeservice", addressLines: ["Hafenstraße 1", "20457 Hamburg"], iban: "DE02120300000000202051" },
    profiles,
  };
}

/** Encrypts a vault the same way the app does, returning the GET /vault DTO shape. */
export async function encryptVaultDto(vault: InvoiceVault, profileRef: string): Promise<EncryptedVaultDTO> {
  const { getOrCreateMasterKey } = await import("../crypto/keyStore");
  const { encryptVault } = await import("../vault/vaultCodec");
  const key = await getOrCreateMasterKey(profileRef);
  const body = await encryptVault(vault, key, { expectedRevision: 0, profileVersion: 1 });
  return {
    companyId: 7,
    revision: 1,
    profileVersion: body.profileVersion,
    cipherAlgorithm: body.cipherAlgorithm ?? "AES-256-GCM",
    encryptedPayloadBase64: body.encryptedPayloadBase64,
    payloadNonceBase64: body.payloadNonceBase64,
    ciphertextSha256Base64: body.ciphertextSha256Base64,
    updatedAt: "2026-09-20T10:00:00Z",
  };
}

export const RECIPIENT = {
  name: "Hausverwaltung Nord GmbH",
  addressLines: ["Mönckebergstraße 7", "20095 Hamburg"],
  ustId: "DE123456789",
};
