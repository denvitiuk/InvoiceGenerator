// Runtime validation of the backend's WorkPackageDTO at the API boundary.
//
// The backend is the source of truth for number, revision, lines, VAT, totals,
// customer and status, so nothing here ever substitutes a made-up value for a
// missing required field: an incompatible payload throws a
// WorkPackageContractError that names every offending field, and the session
// shows it instead of rendering a half-valid invoice.
//
// Compatibility: `items` is the primary line list; the deprecated `lines`
// alias is read only when `items` is absent (older backend builds). Each line
// must still carry the full tax/amount contract either way.

import { decimalToCents, isTaxCategory } from "@/lib/invoiceTax";
import type {
  InvoiceCustomerSnapshotDTO,
  InvoiceNumberSourceDTO,
  InvoiceTotalsDTO,
  VatSummaryEntryDTO,
  WorkPackageDTO,
  WorkPackageLineDTO,
} from "../types";

export class WorkPackageContractError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Incompatible work package from backend: ${problems.slice(0, 8).join("; ")}${problems.length > 8 ? " …" : ""}`);
    this.name = "WorkPackageContractError";
    this.problems = problems;
  }
}

type Obj = Record<string, unknown>;

class Reader {
  readonly problems: string[] = [];

  isObj(v: unknown): v is Obj {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  string(o: Obj, key: string, path: string): string {
    const v = o[key];
    if (typeof v !== "string" || v.trim() === "") {
      this.problems.push(`${path}${key}: expected non-empty string`);
      return "";
    }
    return v;
  }

  /** Nullable field: an explicit null or an absent key both decode to null — never to a guessed value. */
  nullableString(o: Obj, key: string, path: string): string | null {
    const v = o[key];
    if (v === null || v === undefined) return null;
    if (typeof v !== "string") {
      this.problems.push(`${path}${key}: expected string or null`);
      return null;
    }
    return v;
  }

  int(o: Obj, key: string, path: string): number {
    const v = o[key];
    if (typeof v !== "number" || !Number.isInteger(v)) {
      this.problems.push(`${path}${key}: expected integer`);
      return 0;
    }
    return v;
  }

  bool(o: Obj, key: string, path: string): boolean {
    const v = o[key];
    if (typeof v !== "boolean") {
      this.problems.push(`${path}${key}: expected boolean`);
      return false;
    }
    return v;
  }

  decimal(o: Obj, key: string, path: string): string {
    const v = o[key];
    if (typeof v !== "string" || decimalToCents(v) === null) {
      this.problems.push(`${path}${key}: expected decimal string`);
      return "0";
    }
    return v.trim();
  }

  isoDate(o: Obj, key: string, path: string, nullable: boolean): string | null {
    const v = o[key];
    if ((v === null || v === undefined) && nullable) return null;
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      this.problems.push(`${path}${key}: expected ISO date (YYYY-MM-DD)${nullable ? " or null" : ""}`);
      return null;
    }
    return v;
  }

  taxCategory(o: Obj, key: string, path: string): WorkPackageLineDTO["taxCategory"] {
    const v = o[key];
    if (!isTaxCategory(v)) {
      this.problems.push(`${path}${key}: expected one of STANDARD, REDUCED, EXEMPT, REVERSE_CHARGE, SMALL_BUSINESS`);
      return "STANDARD";
    }
    return v;
  }
}

function readLine(r: Reader, raw: unknown, path: string): WorkPackageLineDTO {
  if (!r.isObj(raw)) {
    r.problems.push(`${path}: expected object`);
    raw = {};
  }
  const o = raw as Obj;
  return {
    invoiceWorkItemId: r.string(o, "invoiceWorkItemId", path),
    workDate: r.isoDate(o, "workDate", path, true),
    workType: r.nullableString(o, "workType", path),
    description: r.nullableString(o, "description", path),
    workerCount: r.int(o, "workerCount", path),
    quantity: r.decimal(o, "quantity", path),
    unit: typeof o.unit === "string" ? o.unit : (r.problems.push(`${path}unit: expected string`), ""),
    unitPrice: r.decimal(o, "unitPrice", path),
    vatRate: r.decimal(o, "vatRate", path),
    taxCategory: r.taxCategory(o, "taxCategory", path),
    taxExemptionReason: r.nullableString(o, "taxExemptionReason", path),
    netAmount: r.decimal(o, "netAmount", path),
    vatAmount: r.decimal(o, "vatAmount", path),
    grossAmount: r.decimal(o, "grossAmount", path),
    sortOrder: r.int(o, "sortOrder", path),
    isExcluded: r.bool(o, "isExcluded", path),
    isOverridden: r.bool(o, "isOverridden", path),
    requiresReview: r.bool(o, "requiresReview", path),
  };
}

function readTotals(r: Reader, raw: unknown): InvoiceTotalsDTO {
  if (!r.isObj(raw)) {
    r.problems.push("totals: expected object");
    return { netAmount: "0", vatAmount: "0", grossAmount: "0" };
  }
  return {
    netAmount: r.decimal(raw, "netAmount", "totals."),
    vatAmount: r.decimal(raw, "vatAmount", "totals."),
    grossAmount: r.decimal(raw, "grossAmount", "totals."),
  };
}

function readVatSummary(r: Reader, raw: unknown): VatSummaryEntryDTO[] {
  if (!Array.isArray(raw)) {
    r.problems.push("vatSummary: expected array");
    return [];
  }
  return raw.map((entry, i) => {
    const path = `vatSummary[${i}].`;
    if (!r.isObj(entry)) {
      r.problems.push(`${path}: expected object`);
      entry = {};
    }
    const o = entry as Obj;
    return {
      vatRate: r.decimal(o, "vatRate", path),
      taxCategory: r.taxCategory(o, "taxCategory", path),
      taxExemptionReason: r.nullableString(o, "taxExemptionReason", path),
      netAmount: r.decimal(o, "netAmount", path),
      vatAmount: r.decimal(o, "vatAmount", path),
      grossAmount: r.decimal(o, "grossAmount", path),
    };
  });
}

function readCustomer(r: Reader, raw: unknown): InvoiceCustomerSnapshotDTO | null {
  if (raw === null || raw === undefined) return null;
  if (!r.isObj(raw)) {
    r.problems.push("customer: expected object or null");
    return null;
  }
  return {
    invoiceCustomerId: r.string(raw, "invoiceCustomerId", "customer."),
    customerNumber: r.nullableString(raw, "customerNumber", "customer."),
    displayName: r.nullableString(raw, "displayName", "customer."),
  };
}

function readNumberSource(r: Reader, o: Obj): InvoiceNumberSourceDTO | null {
  const v = o.invoiceNumberSource;
  if (v === null || v === undefined) return null;
  if (v === "SEQUENCE" || v === "MANUAL") return v;
  r.problems.push("invoiceNumberSource: expected SEQUENCE, MANUAL or null");
  return null;
}

/** Validates and normalizes a raw work-package payload. Throws WorkPackageContractError when incompatible. */
export function decodeWorkPackage(raw: unknown): WorkPackageDTO {
  const r = new Reader();
  if (!r.isObj(raw)) throw new WorkPackageContractError(["work package: expected JSON object"]);
  const o = raw;

  let rawLines: unknown;
  let linesField: "items" | "lines";
  if (Array.isArray(o.items)) {
    rawLines = o.items;
    linesField = "items";
  } else if (Array.isArray(o.lines)) {
    rawLines = o.lines;
    linesField = "lines";
  } else {
    r.problems.push("items: expected array (or legacy `lines`)");
    rawLines = [];
    linesField = "items";
  }
  const items = (rawLines as unknown[]).map((l, i) => readLine(r, l, `${linesField}[${i}].`));

  const wp: WorkPackageDTO = {
    invoiceId: r.string(o, "invoiceId", ""),
    invoiceNumber: r.nullableString(o, "invoiceNumber", ""),
    status: r.string(o, "status", ""),
    revision: r.int(o, "revision", ""),
    issueDate: r.isoDate(o, "issueDate", "", true),
    dueDate: r.isoDate(o, "dueDate", "", true),
    currency: r.string(o, "currency", ""),
    invoiceCustomerId: r.nullableString(o, "invoiceCustomerId", ""),
    billingProfileRef: r.string(o, "billingProfileRef", ""),
    customer: readCustomer(r, o.customer),
    invoiceNumberSource: readNumberSource(r, o),
    invoiceNumberPatternSnapshot: r.nullableString(o, "invoiceNumberPatternSnapshot", ""),
    projectId: r.int(o, "projectId", ""),
    projectName: r.string(o, "projectName", ""),
    projectLocation: r.nullableString(o, "projectLocation", ""),
    periodStart: r.isoDate(o, "periodStart", "", false) ?? "",
    periodEnd: r.isoDate(o, "periodEnd", "", false) ?? "",
    vatRate: r.decimal(o, "vatRate", ""),
    timezone: r.string(o, "timezone", ""),
    aggregationMode: r.string(o, "aggregationMode", ""),
    automaticNetAmount: r.decimal(o, "automaticNetAmount", ""),
    requiresReview: r.bool(o, "requiresReview", ""),
    numberReservedAt: r.nullableString(o, "numberReservedAt", ""),
    items,
    totals: readTotals(r, o.totals),
    vatSummary: readVatSummary(r, o.vatSummary),
  };

  if (wp.invoiceNumber !== null && wp.invoiceNumber.trim() === "") {
    r.problems.push("invoiceNumber: expected non-empty string or null");
  }

  if (r.problems.length) throw new WorkPackageContractError(r.problems);
  return wp;
}

/** The lines that count towards the invoice (the backend's totals cover exactly these). */
export function activeItems(wp: Pick<WorkPackageDTO, "items"> | null | undefined): WorkPackageLineDTO[] {
  return (wp?.items ?? []).filter((l) => !l.isExcluded);
}

/**
 * Cross-checks the backend's own invariant sum(active lines) == totals ==
 * sum(vatSummary). A mismatch means the payload can't be trusted for a legally
 * binding invoice; callers block finalization instead of "fixing" the numbers.
 */
export function serverTotalsConsistent(wp: WorkPackageDTO): boolean {
  const sum = (values: string[]) => values.reduce((acc, v) => acc + (decimalToCents(v) ?? NaN), 0);
  const active = activeItems(wp);
  const totalNet = decimalToCents(wp.totals.netAmount);
  const totalVat = decimalToCents(wp.totals.vatAmount);
  const totalGross = decimalToCents(wp.totals.grossAmount);
  return (
    sum(active.map((l) => l.netAmount)) === totalNet &&
    sum(active.map((l) => l.vatAmount)) === totalVat &&
    sum(active.map((l) => l.grossAmount)) === totalGross &&
    sum(wp.vatSummary.map((e) => e.netAmount)) === totalNet &&
    sum(wp.vatSummary.map((e) => e.vatAmount)) === totalVat &&
    sum(wp.vatSummary.map((e) => e.grossAmount)) === totalGross
  );
}
