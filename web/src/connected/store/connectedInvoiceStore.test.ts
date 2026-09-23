// @vitest-environment jsdom
//
// The standalone store (src/lib/store.ts) reads/writes `localStorage` at
// creation time, so this file needs a DOM environment.
import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "@/lib/store";
import { useConnectedInvoiceStore } from "./connectedInvoiceStore";

describe("connectedInvoiceStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useConnectedInvoiceStore.getState().reset();
  });

  it("never persists to, or reads from, the standalone invoice.store localStorage key", () => {
    useStore.getState().patchCompany({ name: "Standalone Co" });
    const beforeConnectedWrites = window.localStorage.getItem("invoice.store");
    expect(beforeConnectedWrites).toContain("Standalone Co");

    useConnectedInvoiceStore.getState().patchCompany({ name: "Connected Co" });
    useConnectedInvoiceStore.getState().patchClient({ name: "Connected Client" });
    useConnectedInvoiceStore.getState().addManualLine({ description: "Manual fee", qty: 1, unitPrice: 10, vatRate: 19 });

    const afterConnectedWrites = window.localStorage.getItem("invoice.store");
    expect(afterConnectedWrites).toBe(beforeConnectedWrites);
    expect(afterConnectedWrites).not.toContain("Connected Co");
    expect(afterConnectedWrites).not.toContain("Manual fee");
  });

  it("keeps the standalone draft in the standalone store, unaffected by a connected session", () => {
    useStore.getState().patchCompany({ name: "Original Standalone Draft" });
    const standaloneBefore = useStore.getState().invoice.company.name;

    useConnectedInvoiceStore.getState().patchCompany({ name: "Different Connected Company" });

    expect(useStore.getState().invoice.company.name).toBe(standaloneBefore);
    expect(useStore.getState().invoice.company.name).toBe("Original Standalone Draft");
  });

  it("addManualLine/removeManualLine keep the computed invoice.items and order in sync", () => {
    const id = useConnectedInvoiceStore.getState().addManualLine({
      description: "Extra work",
      qty: 2,
      unitPrice: 30,
      vatRate: 19,
    });
    expect(useConnectedInvoiceStore.getState().invoice.items).toHaveLength(1);
    expect(useConnectedInvoiceStore.getState().invoice.items[0].description).toBe("Extra work");

    useConnectedInvoiceStore.getState().removeManualLine(id);
    expect(useConnectedInvoiceStore.getState().invoice.items).toHaveLength(0);
    expect(useConnectedInvoiceStore.getState().order).toEqual([]);
  });
});
