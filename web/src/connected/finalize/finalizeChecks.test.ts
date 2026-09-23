// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { makeEmptyInvoice } from "@/lib/store";
import { makeMixedVatWorkPackage, makeWorkPackage, RECIPIENT } from "../testing/fixtures";
import { computeFinalAmounts, finalizeBlockers, invoiceTaxSummary, isNumberEditable, manualLineTaxProblem, recipientProblems } from "./finalizeChecks";
import { mapWorkPackageToInvoiceData, lineDtoToDisplayItem } from "../mapping/workPackageMapping";

const base = {
  manualLines: [],
  canFinalize: true,
  requiresReview: false,
  hasProfileForBillingRef: true,
};

describe("recipient checks", () => {
  it("requires recipient name and address", () => {
    expect(recipientProblems({ name: "", addressLines: [] })).toEqual(["recipient_name_missing", "recipient_address_missing"]);
    expect(recipientProblems({ name: "—", addressLines: ["  "] })).toEqual(["recipient_name_missing", "recipient_address_missing"]);
    expect(recipientProblems(RECIPIENT)).toEqual([]);
  });

  it("blocks finalization while the recipient profile or its details are missing", () => {
    const invoice = makeEmptyInvoice({ client: { name: "", addressLines: [] } });
    expect(
      finalizeBlockers({ ...base, workPackage: makeWorkPackage(), invoice, hasProfileForBillingRef: false })
    ).toEqual(["recipient_profile_missing", "recipient_name_missing", "recipient_address_missing"]);
    expect(finalizeBlockers({ ...base, workPackage: makeWorkPackage(), invoice: makeEmptyInvoice({ client: RECIPIENT }) })).toEqual([]);
  });

  it("blocks when the backend's totals are internally inconsistent, and after finalization", () => {
    const invoice = makeEmptyInvoice({ client: RECIPIENT });
    const broken = makeWorkPackage({ totals: { netAmount: "1.00", vatAmount: "0.19", grossAmount: "1.19" } });
    expect(finalizeBlockers({ ...base, workPackage: broken, invoice })).toContain("server_totals_inconsistent");
    expect(finalizeBlockers({ ...base, workPackage: makeWorkPackage({ status: "FINALIZED" }), invoice })).toContain("status_immutable");
  });
});

describe("number editability", () => {
  it.each(["FINALIZED", "SENT", "PAID", "CANCELLED"])("%s forbids number changes", (status) => {
    expect(isNumberEditable(status)).toBe(false);
  });
  it.each(["READY_FOR_REVIEW", "EDITING", "NUMBER_RESERVED"])("%s allows number changes", (status) => {
    expect(isNumberEditable(status)).toBe(true);
  });
});

describe("manual line tax", () => {
  it("a 0 % manual row needs a zero-rated category and a reason", () => {
    expect(manualLineTaxProblem({ description: "", qty: 1, unitPrice: 1, vatRate: 0 })).toBe(true);
    expect(manualLineTaxProblem({ description: "", qty: 1, unitPrice: 1, vatRate: 0, taxCategory: "EXEMPT" })).toBe(true);
    expect(manualLineTaxProblem({ description: "", qty: 1, unitPrice: 1, vatRate: 0, taxCategory: "EXEMPT", taxExemptionReason: "§ 4 Nr. 12 UStG" })).toBe(false);
    expect(manualLineTaxProblem({ description: "", qty: 1, unitPrice: 1, vatRate: 19, taxCategory: "STANDARD" })).toBe(false);
  });
});

describe("computeFinalAmounts / invoiceTaxSummary", () => {
  it("uses the backend totals as-is when there are no manual rows", () => {
    expect(computeFinalAmounts(makeMixedVatWorkPackage(), [])).toEqual({
      finalNetAmount: "320.00",
      finalVatAmount: "41.20",
      finalGrossAmount: "361.20",
    });
  });

  it("adds locally computed manual rows on top of the backend totals", () => {
    const amounts = computeFinalAmounts(makeMixedVatWorkPackage(), [
      { localId: "m1", item: { description: "Anfahrt", qty: 1, unitPrice: 10, vatRate: 19, taxCategory: "STANDARD" } },
    ]);
    expect(amounts).toEqual({ finalNetAmount: "330.00", finalVatAmount: "43.10", finalGrossAmount: "373.10" });
  });

  it("backend totals and vatSummary survive the mapping into InvoiceData items unchanged", () => {
    const wp = makeMixedVatWorkPackage();
    const items = wp.items.map((l) => lineDtoToDisplayItem(l, "de"));
    const summary = invoiceTaxSummary(items);
    expect([summary.netCents, summary.vatCents, summary.grossCents]).toEqual([32000, 4120, 36120]);
    const byGroup = summary.groups.map((g) => ({ vatAmount: g.vatCents, netAmount: g.netCents }));
    expect(byGroup).toEqual(
      wp.vatSummary.map((e) => ({ vatAmount: Math.round(Number(e.vatAmount) * 100), netAmount: Math.round(Number(e.netAmount) * 100) }))
    );
    expect(items[2]).toMatchObject({ taxCategory: "REVERSE_CHARGE", taxExemptionReason: wp.items[2].taxExemptionReason, vatAmount: "0.00" });
    expect(mapWorkPackageToInvoiceData(wp).number).toBe("");
  });
});
