// @vitest-environment jsdom
// Renders the real Handlebars template (templates/base.hbs) — the exact HTML
// that /api/render prints to PDF — for connected and standalone invoices.
import { describe, expect, it } from "vitest";
import { renderInvoiceHtml } from "../../../server/lib/template";
import { makeEmptyInvoice } from "@/lib/store";
import type { InvoiceData } from "@/types/invoice";
import { lineDtoToDisplayItem, mapWorkPackageToInvoiceData } from "../mapping/workPackageMapping";
import { makeLine, makeMixedVatWorkPackage, makeWorkPackage, RECIPIENT, REVERSE_CHARGE_REASON } from "../testing/fixtures";
import type { WorkPackageDTO } from "../types";

function connectedInvoice(wp: WorkPackageDTO, patch: Partial<InvoiceData> = {}): InvoiceData {
  return makeEmptyInvoice({
    ...mapWorkPackageToInvoiceData(wp),
    language: "de",
    company: { name: "Glanz & Co. Gebäudeservice", addressLines: ["Hafenstraße 1", "20457 Hamburg"] },
    client: RECIPIENT,
    items: wp.items.filter((l) => !l.isExcluded).map((l) => lineDtoToDisplayItem(l, "de")),
    ...patch,
  } as InvoiceData);
}

/** Collapses whitespace and NBSPs so assertions don't depend on template indentation or Intl spacing. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/[\s  ]+/g, " ");
}

const reserved = {
  invoiceNumber: "RE-2026-0042",
  status: "NUMBER_RESERVED",
  issueDate: "2026-09-23",
  dueDate: "2026-10-07",
  invoiceNumberSource: "SEQUENCE" as const,
};

describe("invoice template — connected mode", () => {
  it("shows every mandatory field incl. Rechnungsnummer, dates, recipient, object and totals", async () => {
    const html = text(await renderInvoiceHtml(connectedInvoice(makeMixedVatWorkPackage(reserved)), { language: "de", inlineStyles: true }));
    expect(html).toContain("Rechnungsnummer RE-2026-0042");
    expect(html).toContain("Rechnungsdatum 23.09.2026");
    expect(html).toContain("Leistungszeitraum 01.09.2026 – 30.09.2026");
    expect(html).toContain("Fällig am 07.10.2026");
    expect(html).toContain("Hausverwaltung Nord GmbH");
    expect(html).toContain("Mönckebergstraße 7");
    expect(html).toContain("Kundennummer: K-1001");
    expect(html).toContain("Objekt: Wohnanlage Lindenhof — Hamburg");
    expect(html).toContain("3 Personen · 12 h gesamt"); // worker count
    expect(html).toContain("15,00 €"); // unit price
    expect(html).toContain("Zahlbar innerhalb von 14 Tagen");
  });

  it("mixed VAT: Netto 320,00 / MwSt 19 % 34,20 / MwSt 7 % 7,00 / Gesamt MwSt 41,20 / Gesamtbetrag 361,20", async () => {
    const html = text(await renderInvoiceHtml(connectedInvoice(makeMixedVatWorkPackage(reserved)), { language: "de", inlineStyles: true }));
    expect(html).toContain("Nettobetrag 320,00 €");
    expect(html).toContain("MwSt. 19 % auf 180,00 € 34,20 €");
    expect(html).toContain("MwSt. 7 % auf 100,00 € 7,00 €");
    expect(html).toContain("Gesamt MwSt. 41,20 €");
    expect(html).toContain("Gesamtbetrag 361,20 €");
    // per-line VAT
    expect(html).toMatch(/19 % 34,20 € 180,00 €/);
    expect(html).toMatch(/7 % 7,00 € 100,00 €/);
  });

  it("VAT 19 % only", async () => {
    const html = text(await renderInvoiceHtml(connectedInvoice(makeWorkPackage(reserved)), { language: "de" }));
    expect(html).toContain("MwSt. 19 % auf 180,00 € 34,20 €");
    expect(html).toContain("Gesamtbetrag 214,20 €");
    expect(html).not.toContain("Steuerhinweise");
  });

  it("uses the backend's line amounts verbatim instead of recomputing them", async () => {
    // qty × price would give 99.99 / 19.00 — the backend's (overridden) amounts must win.
    const wp = makeWorkPackage({
      ...reserved,
      items: [makeLine({ quantity: "3", unitPrice: "33.33", netAmount: "100.00", vatAmount: "19.00", grossAmount: "119.00", isOverridden: true })],
      totals: { netAmount: "100.00", vatAmount: "19.00", grossAmount: "119.00" },
    });
    const html = text(await renderInvoiceHtml(connectedInvoice(wp), { language: "de" }));
    expect(html).toContain("Nettobetrag 100,00 €");
    expect(html).toContain("Gesamtbetrag 119,00 €");
    expect(html).not.toContain("99,99 €");
  });

  it.each([
    ["EXEMPT", "Steuerfrei", "Steuerfreie Leistung nach § 4 Nr. 12 UStG"],
    ["REVERSE_CHARGE", "Reverse Charge", REVERSE_CHARGE_REASON],
    ["SMALL_BUSINESS", "Kleinunternehmer (§ 19 UStG)", "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet."],
  ] as const)("%s: no VAT charged and the exemption reason is printed", async (category, label, reason) => {
    const wp = makeWorkPackage({
      ...reserved,
      items: [makeLine({ vatRate: "0.00", taxCategory: category, taxExemptionReason: reason, vatAmount: "0.00", grossAmount: "180.00" })],
      totals: { netAmount: "180.00", vatAmount: "0.00", grossAmount: "180.00" },
      vatSummary: [{ vatRate: "0.00", taxCategory: category, taxExemptionReason: reason, netAmount: "180.00", vatAmount: "0.00", grossAmount: "180.00" }],
    });
    const html = text(await renderInvoiceHtml(connectedInvoice(wp), { language: "de" }));
    expect(html).toContain(`${label} (0 %) auf 180,00 € 0,00 €`);
    expect(html).not.toMatch(/MwSt\. 0 %/);
    expect(html).not.toMatch(/MwSt\. 19 %/);
    expect(html).toContain("Gesamt MwSt. 0,00 €");
    expect(html).toContain("Gesamtbetrag 180,00 €");
    expect(html).toContain("Steuerhinweise");
    expect(html).toContain(`${label}: ${reason}`);
  });

  it("escapes the exemption reason (backend free text) in the HTML", async () => {
    const wp = makeWorkPackage({
      items: [makeLine({ vatRate: "0.00", taxCategory: "EXEMPT", taxExemptionReason: "<img src=x onerror=alert(1)>", vatAmount: "0.00", grossAmount: "180.00" })],
      totals: { netAmount: "180.00", vatAmount: "0.00", grossAmount: "180.00" },
    });
    const html = await renderInvoiceHtml(connectedInvoice(wp), { language: "de" });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("an unreserved invoice renders no Rechnungsnummer (never a placeholder number)", async () => {
    const html = text(await renderInvoiceHtml(connectedInvoice(makeWorkPackage()), { language: "de" }));
    expect(html).not.toContain("Rechnungsnummer");
  });

  it("keeps a number containing '/' unchanged inside the document", async () => {
    const html = text(await renderInvoiceHtml(connectedInvoice(makeWorkPackage({ ...reserved, invoiceNumber: "RE/2026/0042" })), { language: "de" }));
    expect(html).toContain("Rechnungsnummer RE/2026/0042");
  });
});

describe("invoice template — standalone mode is unchanged", () => {
  it("keeps the legacy totals block (Zwischensumme / MwSt. per rate / Gesamtsumme) and §19 handling", async () => {
    const data = makeEmptyInvoice({
      language: "de",
      number: "2026-001",
      issueDateISO: "2026-09-23",
      company: { name: "Solo GmbH", addressLines: [] },
      client: { name: "Kunde", addressLines: ["Weg 1"] },
      items: [
        { description: "A", qty: 2, unitPrice: 50, vatRate: 19 },
        { description: "B", qty: 1, unitPrice: 100, vatRate: 7 },
      ],
    });
    const html = text(await renderInvoiceHtml(data, { language: "de" }));
    expect(html).toContain("Zwischensumme 200,00 €");
    expect(html).toContain("MwSt. 7% 7,00 €");
    expect(html).toContain("MwSt. 19% 19,00 €");
    expect(html).toContain("Gesamtsumme 226,00 €");
    expect(html).not.toContain("Gesamt MwSt.");
    expect(html).not.toContain("Fällig am");

    const ku = text(await renderInvoiceHtml({ ...data, kleinunternehmer: true }, { language: "de" }));
    expect(ku).toContain("Gesamtsumme 200,00 €");
    expect(ku).toContain("Gemäß §19 UStG wird keine Umsatzsteuer berechnet.");
  });
});
