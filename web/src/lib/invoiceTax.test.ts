import { describe, expect, it } from "vitest";
import type { LineItem } from "@/types/invoice";
import { centsToDecimal, computeLineTax, decimalToCents, summarizeTax } from "./invoiceTax";

const local = (qty: number, unitPrice: number, vatRate: number, extra: Partial<LineItem> = {}): LineItem => ({
  description: "x",
  qty,
  unitPrice,
  vatRate,
  ...extra,
});

describe("decimal <-> cents", () => {
  it("parses backend decimal strings exactly and rounds half-up on the third digit", () => {
    expect(decimalToCents("361.20")).toBe(36120);
    expect(decimalToCents("7")).toBe(700);
    expect(decimalToCents("0.125")).toBe(13);
    expect(decimalToCents("0.1249")).toBe(12);
    expect(decimalToCents("-5.5")).toBe(-550);
    expect(decimalToCents("34,20")).toBeNull();
    expect(decimalToCents("1e3")).toBeNull();
    expect(centsToDecimal(4120)).toBe("41.20");
    expect(centsToDecimal(-5)).toBe("-0.05");
  });
});

describe("computeLineTax", () => {
  it("VAT 19 %: computes a manual line locally with 2-decimal half-up rounding", () => {
    const tax = computeLineTax(local(3, 33.33, 19));
    expect(tax).toMatchObject({ netCents: 9999, vatCents: 1900, grossCents: 11899, source: "local" });
  });

  it("VAT 7 %", () => {
    const tax = computeLineTax(local(4, 25, 7, { taxCategory: "REDUCED" }));
    expect(tax).toMatchObject({ netCents: 10000, vatCents: 700, grossCents: 10700, taxCategory: "REDUCED" });
  });

  it("takes backend amounts verbatim for server lines, even if a local recomputation would differ", () => {
    // 12 × 15.00 = 180.00; the backend's line VAT is authoritative.
    const tax = computeLineTax(local(12, 15, 19, { netAmount: "180.00", vatAmount: "34.20", grossAmount: "214.20", taxCategory: "STANDARD" }));
    expect(tax).toMatchObject({ netCents: 18000, vatCents: 3420, grossCents: 21420, source: "server" });
  });

  it.each(["EXEMPT", "REVERSE_CHARGE", "SMALL_BUSINESS"] as const)("%s never charges VAT, even with a stray non-zero rate", (cat) => {
    const tax = computeLineTax(local(1, 100, 19, { taxCategory: cat, taxExemptionReason: "reason" }));
    expect(tax).toMatchObject({ netCents: 10000, vatCents: 0, grossCents: 10000, vatRate: 0, taxCategory: cat });
  });

  it("keeps a 0 % rate at 0 % (no 19 % default)", () => {
    expect(computeLineTax(local(1, 50, 0)).vatCents).toBe(0);
  });
});

describe("summarizeTax", () => {
  it("mixed rates: Netto 320,00 / MwSt 19 % 34,20 / MwSt 7 % 7,00 / Gesamt MwSt 41,20 / Gesamt 361,20", () => {
    const summary = summarizeTax([
      computeLineTax(local(12, 15, 19, { taxCategory: "STANDARD", netAmount: "180.00", vatAmount: "34.20", grossAmount: "214.20" })),
      computeLineTax(local(4, 25, 7, { taxCategory: "REDUCED", netAmount: "100.00", vatAmount: "7.00", grossAmount: "107.00" })),
      computeLineTax(local(1, 40, 0, { taxCategory: "REVERSE_CHARGE", taxExemptionReason: "§ 13b UStG", netAmount: "40.00", vatAmount: "0.00", grossAmount: "40.00" })),
    ]);
    expect(summary.netCents).toBe(32000);
    expect(summary.vatCents).toBe(4120);
    expect(summary.grossCents).toBe(36120);
    expect(summary.groups.map((g) => [g.vatRate, g.taxCategory, g.vatCents])).toEqual([
      [19, "STANDARD", 3420],
      [7, "REDUCED", 700],
      [0, "REVERSE_CHARGE", 0],
    ]);
    expect(summary.exemptionReasons).toEqual([{ taxCategory: "REVERSE_CHARGE", reason: "§ 13b UStG" }]);
  });

  it("rounds VAT per line and sums the rounded values (like the backend)", () => {
    // 3 lines of 0.05 @ 19 % -> 0.0095 each -> 0.01 each -> 0.03 total (not round(0.0285) = 0.03 by luck: use 0.03 net)
    const summary = summarizeTax([local(1, 0.03, 19), local(1, 0.03, 19), local(1, 0.03, 19)].map((l) => computeLineTax(l)));
    expect(summary.vatCents).toBe(3); // 3 × round(0.57 ct) = 3 × 1 ct
  });
});
