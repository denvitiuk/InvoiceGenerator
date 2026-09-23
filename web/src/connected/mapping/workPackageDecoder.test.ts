import { describe, expect, it } from "vitest";
import { makeLine, makeMixedVatWorkPackage, makeWorkPackage } from "../testing/fixtures";
import { activeItems, decodeWorkPackage, serverTotalsConsistent, WorkPackageContractError } from "./workPackageDecoder";

/** A JSON round-trip, like a real response body. */
function wire<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("decodeWorkPackage", () => {
  it("decodes the current backend work package (customer, numbering, items, totals, vatSummary)", () => {
    const wp = decodeWorkPackage(wire(makeMixedVatWorkPackage()));
    expect(wp.invoiceNumber).toBeNull();
    expect(wp.billingProfileRef).toBe("profile-1");
    expect(wp.customer).toEqual({ invoiceCustomerId: "cust-1", customerNumber: "K-1001", displayName: "Hausverwaltung Nord GmbH" });
    expect(wp.items).toHaveLength(3);
    expect(wp.items[2]).toMatchObject({ taxCategory: "REVERSE_CHARGE", vatRate: "0.00", vatAmount: "0.00" });
    expect(wp.totals).toEqual({ netAmount: "320.00", vatAmount: "41.20", grossAmount: "361.20" });
    expect(wp.vatSummary).toHaveLength(3);
  });

  it("uses `items` before the deprecated `lines` alias", () => {
    const raw = wire({
      ...makeWorkPackage(),
      items: [makeLine({ invoiceWorkItemId: "from-items" })],
      lines: [makeLine({ invoiceWorkItemId: "from-lines" })],
    });
    expect(decodeWorkPackage(raw).items.map((l) => l.invoiceWorkItemId)).toEqual(["from-items"]);
  });

  it("falls back to legacy `lines` when an older backend sends no `items`", () => {
    const { items: _items, ...legacy } = makeWorkPackage({ lines: [makeLine({ invoiceWorkItemId: "legacy-1" })] });
    const wp = decodeWorkPackage(wire(legacy));
    expect(wp.items.map((l) => l.invoiceWorkItemId)).toEqual(["legacy-1"]);
  });

  it("decodes invoiceNumber: null as a pending (unreserved) number, never as a placeholder", () => {
    const wp = decodeWorkPackage(wire(makeWorkPackage({ invoiceNumber: null, invoiceNumberSource: null })));
    expect(wp.invoiceNumber).toBeNull();
    expect(wp.invoiceNumberSource).toBeNull();
  });

  it("rejects a payload missing required fields and names each one instead of inventing values", () => {
    const { totals: _t, vatSummary: _v, billingProfileRef: _b, ...raw } = makeWorkPackage();
    const brokenLine = { ...makeLine() } as Record<string, unknown>;
    delete brokenLine.taxCategory;
    delete brokenLine.netAmount;
    try {
      decodeWorkPackage(wire({ ...raw, items: [brokenLine] }));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(WorkPackageContractError);
      const problems = (e as WorkPackageContractError).problems.join("\n");
      expect(problems).toContain("billingProfileRef");
      expect(problems).toContain("totals");
      expect(problems).toContain("vatSummary");
      expect(problems).toContain("items[0].taxCategory");
      expect(problems).toContain("items[0].netAmount");
    }
  });

  it("rejects unknown tax categories and non-decimal amounts", () => {
    const raw = wire(makeWorkPackage({ items: [makeLine({ taxCategory: "ZERO" as never, vatAmount: "34,20" })] }));
    expect(() => decodeWorkPackage(raw)).toThrow(/taxCategory[\s\S]*vatAmount|vatAmount[\s\S]*taxCategory/);
  });

  it("rejects a payload with neither items nor lines", () => {
    const { items: _i, lines: _l, ...raw } = makeWorkPackage();
    expect(() => decodeWorkPackage(wire(raw))).toThrow(WorkPackageContractError);
  });
});

describe("serverTotalsConsistent", () => {
  it("holds for backend payloads (sum(lines) == totals == sum(vatSummary)), excluded lines not counted", () => {
    const wp = makeMixedVatWorkPackage();
    expect(serverTotalsConsistent(wp)).toBe(true);
    const withExcluded = makeMixedVatWorkPackage({
      items: [...wp.items, makeLine({ invoiceWorkItemId: "x", isExcluded: true, netAmount: "999.00", vatAmount: "1.00", grossAmount: "1000.00" })],
    });
    expect(activeItems(withExcluded)).toHaveLength(3);
    expect(serverTotalsConsistent(withExcluded)).toBe(true);
  });

  it("detects a mismatch between totals and line amounts", () => {
    expect(serverTotalsConsistent(makeWorkPackage({ totals: { netAmount: "180.00", vatAmount: "34.21", grossAmount: "214.21" } }))).toBe(false);
  });
});
