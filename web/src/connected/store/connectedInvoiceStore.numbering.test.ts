// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { makeMixedVatWorkPackage, RECIPIENT } from "../testing/fixtures";
import { useConnectedInvoiceStore } from "./connectedInvoiceStore";

describe("connectedInvoiceStore — backend-owned header fields", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useConnectedInvoiceStore.getState().reset();
  });

  it("applyNumberResult writes the backend number, revision, dates and source into the invoice", () => {
    const store = useConnectedInvoiceStore.getState();
    store.setWorkPackage(makeMixedVatWorkPackage());
    expect(useConnectedInvoiceStore.getState().invoice.number).toBe("");

    store.applyNumberResult({
      invoiceNumber: "RE-2026-0042",
      revision: 6,
      status: "NUMBER_RESERVED",
      issueDate: "2026-09-23",
      dueDate: "2026-10-07",
      invoiceNumberSource: "SEQUENCE",
      invoiceNumberPatternSnapshot: null,
    });

    const s = useConnectedInvoiceStore.getState();
    expect(s.invoice).toMatchObject({ number: "RE-2026-0042", issueDateISO: "2026-09-23", dueDateISO: "2026-10-07", dueDays: 14 });
    expect(s.workPackage).toMatchObject({ invoiceNumber: "RE-2026-0042", revision: 6, status: "NUMBER_RESERVED", invoiceNumberSource: "SEQUENCE" });
    // Server lines keep the backend amounts after the header update.
    expect(s.invoice.items.map((i) => i.vatAmount)).toEqual(["34.20", "7.00", "0.00"]);
  });

  it("an older document snapshot can't override the backend number or bring another profile's recipient", () => {
    const store = useConnectedInvoiceStore.getState();
    store.setWorkPackage(makeMixedVatWorkPackage({ invoiceNumber: "RE-2026-0042", status: "NUMBER_RESERVED" }));
    store.patchClient(RECIPIENT);

    store.loadDocumentSnapshot({
      schemaVersion: 1,
      billingProfileRef: "some-other-profile",
      invoiceDataSubset: { number: "STALE-1", client: { name: "Old Customer", addressLines: ["Elsewhere 1"] }, notes: ["kept"] },
      manualLines: [],
      order: [],
    });

    const s = useConnectedInvoiceStore.getState();
    expect(s.invoice.number).toBe("RE-2026-0042");
    expect(s.invoice.client).toEqual(RECIPIENT);
    expect(s.invoice.notes).toEqual(["kept"]);
    expect(s.exportDocumentSnapshot().billingProfileRef).toBe("profile-1");
  });

  it("customer number and object come from the work package", () => {
    useConnectedInvoiceStore.getState().setWorkPackage(makeMixedVatWorkPackage());
    const inv = useConnectedInvoiceStore.getState().invoice;
    expect(inv.customerNumber).toBe("K-1001");
    expect(inv.object).toBe("Wohnanlage Lindenhof — Hamburg");
  });
});
