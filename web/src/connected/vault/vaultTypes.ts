import type { ClientInfo, CompanyInfo, InvoiceTheme, LineItem } from "@/types/invoice";

export interface InvoiceVaultProfile {
  client: ClientInfo;
  dueDays?: number;
  notes?: string[];
  theme?: InvoiceTheme;
  defaultItems?: LineItem[];
}

export interface InvoiceVault {
  schemaVersion: 1;
  company: CompanyInfo;
  profiles: Record<string, InvoiceVaultProfile>;
}

export function makeEmptyVault(company?: CompanyInfo): InvoiceVault {
  return {
    schemaVersion: 1,
    company: company ?? { name: "", addressLines: [] },
    profiles: {},
  };
}
