// One-time, opt-in import of the existing standalone default template into an
// Invoice Vault profile draft. Read-only against the existing localStorage
// template mechanism (`invoice:templates` / `invoice:templates:defaultId`,
// managed by AppShell.tsx) — never writes to it, never runs automatically, and
// the caller (VaultImportPrompt) must never overwrite an existing profile for
// the same billingProfileRef without the admin's explicit confirmation.

import type { InvoiceData } from "@/types/invoice";
import type { InvoiceVaultProfile } from "./vaultTypes";

const TEMPLATES_LS_KEY = "invoice:templates";
const TEMPLATES_DEFAULT_ID_KEY = "invoice:templates:defaultId";

interface StoredInvoiceTemplate {
  id: string;
  name: string;
  updatedAt: string;
  data: Partial<InvoiceData>;
}

function readStoredTemplates(): StoredInvoiceTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TEMPLATES_LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as StoredInvoiceTemplate[]) : [];
  } catch {
    return [];
  }
}

function readDefaultTemplateId(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(TEMPLATES_DEFAULT_ID_KEY) || "";
  } catch {
    return "";
  }
}

export interface VaultImportCandidate {
  companyName: string;
  templateName: string;
  profileDraft: InvoiceVaultProfile;
  companyDraft: Partial<InvoiceData["company"]>;
}

/** Returns a vault-profile draft built from the current default template, or null if there is none to import. */
export function buildVaultImportCandidate(): VaultImportCandidate | null {
  const defaultId = readDefaultTemplateId();
  if (!defaultId) return null;
  const tpl = readStoredTemplates().find((t) => t.id === defaultId);
  if (!tpl) return null;

  const data = tpl.data || {};
  return {
    companyName: data.company?.name || "",
    templateName: tpl.name,
    companyDraft: data.company ?? {},
    profileDraft: {
      client: data.client ?? { name: "", addressLines: [] },
      dueDays: data.dueDays,
      theme: data.theme,
      defaultItems: Array.isArray(data.items) ? data.items.map((it) => ({ ...it })) : undefined,
    },
  };
}
