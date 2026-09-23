// VAT (MwSt) arithmetic shared by the connected-mode UI, the finalize request
// and the PDF/HTML template (server/lib/template.ts), so all three agree to the
// cent. Mirrors the backend's InvoiceTax rules: money is kept in integer cents,
// line VAT is rounded half-up per line, and totals / the per-rate summary are
// sums of the already-rounded line amounts.
//
// Lines that carry backend amounts (connected-mode server lines) are taken
// verbatim — never recomputed. Only lines without amounts (manual rows) are
// computed here.

import type { LineItem, TaxCategory } from "@/types/invoice";

export const TAX_CATEGORIES: readonly TaxCategory[] = [
  "STANDARD",
  "REDUCED",
  "EXEMPT",
  "REVERSE_CHARGE",
  "SMALL_BUSINESS",
] as const;

export function isTaxCategory(value: unknown): value is TaxCategory {
  return typeof value === "string" && (TAX_CATEGORIES as readonly string[]).includes(value);
}

/** Categories where no VAT is charged: rate is 0 and a legal reason is mandatory. */
export function isZeroRatedCategory(category: TaxCategory | undefined | null): boolean {
  return category === "EXEMPT" || category === "REVERSE_CHARGE" || category === "SMALL_BUSINESS";
}

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/**
 * Parses a plain decimal string ("361.2", "7", "-0.5") into integer cents,
 * rounding half-up on the third fraction digit. Returns null for anything that
 * is not a plain decimal (no thousands separators, no exponent).
 */
export function decimalToCents(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!DECIMAL_RE.test(s)) return null;
  const negative = s.startsWith("-");
  const [intPart, fracPart = ""] = (negative ? s.slice(1) : s).split(".");
  let cents = Number(intPart) * 100 + Number((fracPart + "00").slice(0, 2));
  if (fracPart.length > 2 && Number(fracPart[2]) >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

export function centsToDecimal(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const str = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return negative && abs !== 0 ? `-${str}` : str;
}

export function centsToNumber(cents: number): number {
  return Math.round(cents) / 100;
}

/** Half-up (away from zero) rounding of an already-in-cents float, tolerant of binary float noise. */
function roundCents(valueInCents: number): number {
  if (!Number.isFinite(valueInCents)) return 0;
  const abs = Math.round(Number(Math.abs(valueInCents).toFixed(6)));
  return valueInCents < 0 ? -abs : abs;
}

export interface LineTax {
  netCents: number;
  vatCents: number;
  grossCents: number;
  /** Numeric VAT rate in percent (0 for zero-rated categories). */
  vatRate: number;
  taxCategory?: TaxCategory;
  taxExemptionReason?: string;
  /** "server": amounts taken verbatim from the backend; "local": computed here. */
  source: "server" | "local";
}

function finiteOrZero(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : 0;
}

/**
 * Tax for one line. `quantityOverride` lets the template pass a quantity it
 * derived itself (monthly daily-breakdown rows); ignored for server amounts.
 */
export function computeLineTax(item: LineItem, quantityOverride?: number): LineTax {
  const category = isTaxCategory(item.taxCategory) ? item.taxCategory : undefined;
  const reason = typeof item.taxExemptionReason === "string" && item.taxExemptionReason.trim()
    ? item.taxExemptionReason.trim()
    : undefined;
  const zeroRated = isZeroRatedCategory(category);
  const vatRate = zeroRated ? 0 : finiteOrZero(item.vatRate);

  const serverNet = decimalToCents(item.netAmount);
  const serverVat = decimalToCents(item.vatAmount);
  const serverGross = decimalToCents(item.grossAmount);
  if (serverNet !== null && serverVat !== null && serverGross !== null) {
    return {
      netCents: serverNet,
      vatCents: serverVat,
      grossCents: serverGross,
      vatRate,
      taxCategory: category,
      taxExemptionReason: reason,
      source: "server",
    };
  }

  const qty = quantityOverride !== undefined ? finiteOrZero(quantityOverride) : finiteOrZero(item.qty);
  const netCents = roundCents(qty * finiteOrZero(item.unitPrice) * 100);
  const vatCents = zeroRated ? 0 : roundCents((netCents * vatRate) / 100);
  return {
    netCents,
    vatCents,
    grossCents: netCents + vatCents,
    vatRate,
    taxCategory: category,
    taxExemptionReason: reason,
    source: "local",
  };
}

export interface TaxGroup {
  vatRate: number;
  taxCategory?: TaxCategory;
  taxExemptionReason?: string;
  zeroRated: boolean;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export interface TaxSummary {
  netCents: number;
  vatCents: number;
  grossCents: number;
  /** Taxable groups first (highest rate first), then zero-rated groups. */
  groups: TaxGroup[];
  /** Distinct exemption reasons of zero-rated groups, in first-seen order. */
  exemptionReasons: { taxCategory?: TaxCategory; reason: string }[];
}

export function summarizeTax(lines: LineTax[]): TaxSummary {
  const groups = new Map<string, TaxGroup>();
  let netCents = 0;
  let vatCents = 0;
  let grossCents = 0;

  for (const line of lines) {
    netCents += line.netCents;
    vatCents += line.vatCents;
    grossCents += line.grossCents;
    const zeroRated = isZeroRatedCategory(line.taxCategory);
    const key = `${line.taxCategory ?? ""}|${line.vatRate}|${zeroRated ? line.taxExemptionReason ?? "" : ""}`;
    const group = groups.get(key) ?? {
      vatRate: line.vatRate,
      taxCategory: line.taxCategory,
      taxExemptionReason: zeroRated ? line.taxExemptionReason : undefined,
      zeroRated,
      netCents: 0,
      vatCents: 0,
      grossCents: 0,
    };
    group.netCents += line.netCents;
    group.vatCents += line.vatCents;
    group.grossCents += line.grossCents;
    groups.set(key, group);
  }

  const ordered = Array.from(groups.values()).sort((a, b) => {
    if (a.zeroRated !== b.zeroRated) return a.zeroRated ? 1 : -1;
    return b.vatRate - a.vatRate;
  });

  const seen = new Set<string>();
  const exemptionReasons: TaxSummary["exemptionReasons"] = [];
  for (const g of ordered) {
    if (!g.zeroRated || !g.taxExemptionReason) continue;
    const key = `${g.taxCategory}|${g.taxExemptionReason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    exemptionReasons.push({ taxCategory: g.taxCategory, reason: g.taxExemptionReason });
  }

  return { netCents, vatCents, grossCents, groups: ordered, exemptionReasons };
}

/** True when any line carries connected-mode tax data (category or backend amounts). */
export function hasConnectedTaxData(items: LineItem[] | undefined): boolean {
  return (items ?? []).some((it) => isTaxCategory(it.taxCategory) || decimalToCents(it.netAmount) !== null);
}

/** Formats a percent rate like the backend ("19", "7", "10.5"), without trailing zeros. */
export function formatRate(rate: number): string {
  return String(Math.round(rate * 100) / 100);
}
