// Maps a backend WorkPackageDTO onto this app's existing InvoiceData/LineItem
// model, and keeps server-provided lines stably linked across re-fetches.
//
// Field mapping (per spec):
//   currency            -> InvoiceData.currency
//   periodStart/End      -> InvoiceData.servicePeriod
//   projectName+Location -> InvoiceData.object
//   invoiceNumber        -> InvoiceData.number
//   issueDate             -> InvoiceData.issueDateISO
//   issueDate/dueDate diff -> InvoiceData.dueDays
//   active lines           -> InvoiceData.items

import type { InvoiceData, LineItem } from "@/types/invoice";
import type { UILang } from "@/lib/i18n";
import { cdbg } from "../debug";
import type { WorkPackageDTO, WorkPackageLineDTO } from "../types";
import { decimalStringToNumber } from "./money";

type Lang = UILang;

const LOCALE_BY_LANG: Record<Lang, string> = {
  en: "en-US",
  de: "de-DE",
  ru: "ru-RU",
  bg: "bg-BG",
  tr: "tr-TR",
  uk: "uk-UA",
};

const PEOPLE_TOTAL_PHRASE: Record<Lang, (people: number, qty: string, unit: string) => string> = {
  de: (people, qty, unit) => `${people} ${people === 1 ? "Person" : "Personen"} · ${qty} ${unit} gesamt`,
  en: (people, qty, unit) => `${people} ${people === 1 ? "person" : "people"} · ${qty} ${unit} total`,
  ru: (people, qty, unit) => `${people} чел. · ${qty} ${unit} всего`,
  bg: (people, qty, unit) => `${people} души · ${qty} ${unit} общо`,
  tr: (people, qty, unit) => `${people} kişi · toplam ${qty} ${unit}`,
  uk: (people, qty, unit) => `${people} ос. · ${qty} ${unit} разом`,
};

function formatDateLabel(isoDate: string, lang: Lang): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat(LOCALE_BY_LANG[lang] ?? "en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function formatQuantityLabel(value: string, lang: Lang): string {
  const n = decimalStringToNumber(value);
  return new Intl.NumberFormat(LOCALE_BY_LANG[lang] ?? "en-US", { maximumFractionDigits: 2 }).format(n);
}

/**
 * Builds the enriched, localized description for a server line. Never divides
 * total hours/quantity by workerCount and never claims an equal split — the
 * backend only guarantees the aggregate, not each worker's individual time.
 */
export function enrichLineDescription(line: WorkPackageLineDTO, lang: Lang): string {
  const parts: string[] = [];
  if (line.workDate) parts.push(formatDateLabel(line.workDate, lang));

  const base = (line.description || "").trim();
  if (base) parts.push(base);

  if (line.workerCount > 0) {
    const phrase = (PEOPLE_TOTAL_PHRASE[lang] ?? PEOPLE_TOTAL_PHRASE.en)(
      line.workerCount,
      formatQuantityLabel(line.quantity, lang),
      line.unit || ""
    );
    parts.push(phrase);
  }

  return parts.join(" · ");
}

export function lineDtoToDisplayItem(line: WorkPackageLineDTO, lang: Lang): LineItem {
  return {
    group: line.workType || undefined,
    description: enrichLineDescription(line, lang),
    qty: decimalStringToNumber(line.quantity),
    unit: line.unit || undefined,
    unitPrice: decimalStringToNumber(line.unitPrice),
    vatRate: decimalStringToNumber(line.vatRate),
    serverItemId: line.invoiceWorkItemId,
    serverExcluded: line.isExcluded,
  };
}

function computeDueDays(issueDate?: string, dueDate?: string): number | undefined {
  if (!issueDate || !dueDate) return undefined;
  const issue = new Date(`${issueDate}T00:00:00Z`).getTime();
  const due = new Date(`${dueDate}T00:00:00Z`).getTime();
  if (Number.isNaN(issue) || Number.isNaN(due)) return undefined;
  const days = Math.round((due - issue) / 86_400_000);
  return days >= 0 ? days : undefined;
}

export function mapWorkPackageToInvoiceData(wp: WorkPackageDTO): Partial<InvoiceData> {
  const object = [wp.projectName, wp.projectLocation].filter(Boolean).join(" — ") || undefined;
  return {
    currency: wp.currency as InvoiceData["currency"],
    servicePeriod: { fromISO: wp.periodStart, toISO: wp.periodEnd },
    object,
    number: wp.invoiceNumber || "",
    issueDateISO: wp.issueDate || "",
    dueDays: computeDueDays(wp.issueDate, wp.dueDate),
  };
}

export function keyForServerLine(invoiceWorkItemId: string): string {
  return `srv:${invoiceWorkItemId}`;
}

export function keyForManualLine(localId: string): string {
  return `local:${localId}`;
}

/**
 * Preserves the previous combined display order across a fresh WorkPackageDTO:
 * existing server-line keys keep their position, existing manual-line keys are
 * untouched, genuinely new server lines are appended (in DTO sortOrder), and any
 * previously-known server-line key that vanished from the DTO is dropped
 * defensively (should not normally happen — exclude never deletes a line).
 */
export function reconcileOrder(
  previousOrder: string[],
  activeServerLines: WorkPackageLineDTO[],
  manualLineKeys: string[]
): string[] {
  const sortedServerLines = [...activeServerLines].sort((a, b) => a.sortOrder - b.sortOrder);
  const currentServerKeys = new Set(sortedServerLines.map((l) => keyForServerLine(l.invoiceWorkItemId)));
  const currentManualKeys = new Set(manualLineKeys);

  const kept = previousOrder.filter((key) => {
    if (key.startsWith("srv:")) {
      const stillPresent = currentServerKeys.has(key);
      if (!stillPresent) {
        cdbg("workPackageMapping.reconcileOrder.dropped_missing_server_line", { key });
      }
      return stillPresent;
    }
    return currentManualKeys.has(key);
  });

  const keptSet = new Set(kept);
  const appended = sortedServerLines
    .map((l) => keyForServerLine(l.invoiceWorkItemId))
    .filter((key) => !keptSet.has(key));

  const appendedManual = manualLineKeys.filter((key) => !keptSet.has(key));

  return [...kept, ...appended, ...appendedManual];
}
