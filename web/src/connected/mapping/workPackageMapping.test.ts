import { describe, expect, it } from "vitest";
import type { WorkPackageDTO, WorkPackageLineDTO } from "../types";
import {
  enrichLineDescription,
  keyForManualLine,
  keyForServerLine,
  lineDtoToDisplayItem,
  mapWorkPackageToInvoiceData,
  reconcileOrder,
} from "./workPackageMapping";
import { makeWorkPackage } from "../testing/fixtures";

function line(overrides: Partial<WorkPackageLineDTO> = {}): WorkPackageLineDTO {
  return {
    invoiceWorkItemId: "item-1",
    workDate: "2026-09-01",
    workType: "Cleaning",
    description: "Office cleaning",
    workerCount: 3,
    quantity: "15",
    unit: "h",
    unitPrice: "25.00",
    vatRate: "19",
    taxCategory: "STANDARD",
    taxExemptionReason: null,
    netAmount: "375.00",
    vatAmount: "71.25",
    grossAmount: "446.25",
    sortOrder: 0,
    isExcluded: false,
    isOverridden: false,
    requiresReview: false,
    ...overrides,
  };
}

function wp(overrides: Partial<WorkPackageDTO> = {}): WorkPackageDTO {
  return makeWorkPackage({
    status: "DRAFT",
    revision: 1,
    projectName: "Acme Site",
    projectLocation: "Berlin",
    automaticNetAmount: "375.00",
    items: [line()],
    totals: { netAmount: "375.00", vatAmount: "71.25", grossAmount: "446.25" },
    vatSummary: [
      { vatRate: "19", taxCategory: "STANDARD", taxExemptionReason: null, netAmount: "375.00", vatAmount: "71.25", grossAmount: "446.25" },
    ],
    ...overrides,
  });
}

describe("mapWorkPackageToInvoiceData", () => {
  it("maps currency, period, object, number per the field mapping table", () => {
    const mapped = mapWorkPackageToInvoiceData(wp());
    expect(mapped.currency).toBe("EUR");
    expect(mapped.servicePeriod).toEqual({ fromISO: "2026-09-01", toISO: "2026-09-30" });
    expect(mapped.object).toBe("Acme Site — Berlin");
    expect(mapped.number).toBe("");
  });

  it("computes dueDays from the issueDate/dueDate difference when both are present", () => {
    const mapped = mapWorkPackageToInvoiceData(wp({ issueDate: "2026-09-01", dueDate: "2026-09-15" }));
    expect(mapped.issueDateISO).toBe("2026-09-01");
    expect(mapped.dueDays).toBe(14);
  });

  it("leaves dueDays undefined when either date is missing", () => {
    const mapped = mapWorkPackageToInvoiceData(wp({ issueDate: "2026-09-01", dueDate: null }));
    expect(mapped.dueDays).toBeUndefined();
  });
});

describe("enrichLineDescription", () => {
  it("never divides total quantity by workerCount or implies an equal split", () => {
    const desc = enrichLineDescription(line({ workerCount: 3, quantity: "15", unit: "h" }), "de");
    expect(desc).toContain("3 Personen");
    expect(desc).toContain("15 h gesamt");
    // The old per-day phrasing style ("3 × 5 Std.") implies an equal per-worker
    // split; the aggregate phrasing must never use "×" at all.
    expect(desc).not.toContain("×");
  });

  it("omits the worker phrase entirely when workerCount is 0", () => {
    const desc = enrichLineDescription(line({ workerCount: 0 }), "en");
    expect(desc).not.toMatch(/person|people/i);
  });
});

describe("lineDtoToDisplayItem", () => {
  it("stably links the display item back to its invoiceWorkItemId, invisibly to normal LineItem consumers", () => {
    const item = lineDtoToDisplayItem(line({ invoiceWorkItemId: "wi-9", isExcluded: false }), "en");
    expect(item.serverItemId).toBe("wi-9");
    expect(item.serverExcluded).toBe(false);
    expect(item.qty).toBe(15);
    expect(item.unitPrice).toBe(25);
  });
});

describe("reconcileOrder", () => {
  it("appends genuinely new server lines and preserves manual line keys", () => {
    const order = reconcileOrder([], [line({ invoiceWorkItemId: "a" }), line({ invoiceWorkItemId: "b", sortOrder: 1 })], [
      "local:m1",
    ]);
    expect(order).toEqual([keyForServerLine("a"), keyForServerLine("b"), keyForManualLine("m1")]);
  });

  it("keeps previous ordering stable across a re-fetch and drops a line that vanished", () => {
    const previous = [keyForServerLine("a"), keyForManualLine("m1"), keyForServerLine("b")];
    // "b" no longer present in the fresh DTO (e.g. it was excluded — filtered out by the caller before calling this).
    const next = reconcileOrder(previous, [line({ invoiceWorkItemId: "a" })], [keyForManualLine("m1")]);
    expect(next).toEqual([keyForServerLine("a"), keyForManualLine("m1")]);
  });

  it("never produces duplicate keys", () => {
    const previous = [keyForServerLine("a")];
    const next = reconcileOrder(previous, [line({ invoiceWorkItemId: "a" })], []);
    expect(next).toEqual([keyForServerLine("a")]);
    expect(new Set(next).size).toBe(next.length);
  });
});
