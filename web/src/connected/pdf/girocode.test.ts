// GiroCode (EPC QR, EPC069-12 v002) next to the bank details of an issued invoice:
// banking apps pre-fill recipient, IBAN, BIC, amount and reference from it.
import { describe, expect, it } from "vitest";
import { epcPayload, giroCodeSvg } from "../../../server/lib/girocode";
import { buildPreviewHtml } from "../../../pages/api/render";
import backendRenderRequest from "../testing/backendPreviewRenderRequest.json";

type RenderBody = { data: Record<string, any>; language: string };

function body(patch: Partial<RenderBody["data"]> = {}, language?: string): RenderBody {
  const base = structuredClone(backendRenderRequest) as RenderBody;
  const lang = language ?? base.language;
  return { data: { ...base.data, language: lang, ...patch }, language: lang };
}

const valid = {
  name: "Glanz & Co. Gebäudeservice",
  iban: "DE89 3704 0044 0532 0130 00",
  bic: "cobadeffxxx",
  currency: "EUR",
  amountCents: 27965,
  remittance: "Rechnung RE-2026-001 Kd.-Nr. K-1001",
};

describe("EPC payload", () => {
  it("follows EPC069-12 version 002 line by line", () => {
    expect(epcPayload(valid)).toBe([
      "BCD", "002", "1", "SCT", "COBADEFFXXX", "Glanz & Co. Gebäudeservice", "DE89370400440532013000",
      "EUR279.65", "", "", "Rechnung RE-2026-001 Kd.-Nr. K-1001",
    ].join("\n"));
  });

  it("formats cents exactly and leaves an invalid BIC out (optional since v002)", () => {
    expect(epcPayload({ ...valid, amountCents: 5 })).toContain("\nEUR0.05\n");
    expect(epcPayload({ ...valid, amountCents: 100000 })).toContain("\nEUR1000.00\n");
    expect(epcPayload({ ...valid, bic: "not a bic" })!.split("\n")[4]).toBe("");
  });

  it("clips name (70) and reference (140) to the EPC limits", () => {
    const lines = epcPayload({ ...valid, name: "N".repeat(90), remittance: "R".repeat(200) })!.split("\n");
    expect(lines[5]).toHaveLength(70);
    expect(lines[10]).toHaveLength(140);
  });

  it("produces no code for other currencies, bad IBANs or impossible amounts", () => {
    expect(epcPayload({ ...valid, currency: "CHF" })).toBeNull();
    expect(epcPayload({ ...valid, iban: "12345" })).toBeNull();
    expect(epcPayload({ ...valid, amountCents: 0 })).toBeNull();
    expect(epcPayload({ ...valid, amountCents: 100_000_000_000 })).toBeNull();
    expect(epcPayload({ ...valid, name: "   " })).toBeNull();
  });

  it("renders a self-contained SVG", () => {
    const svg = giroCodeSvg(valid)!;
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('fill="#000000"');
    expect(svg).not.toContain("Gebäudeservice"); // the data lives in the modules only
  });
});

describe("GiroCode on the invoice", () => {
  it("is printed next to the bank details of an issued invoice", async () => {
    const html = await buildPreviewHtml(body({ draft: false, number: "RE-2026-001" }));
    expect(html).toContain('class="girocode"');
    expect(html).toContain("Mit der Banking-App scannen (GiroCode)");
  });

  it("is never printed on a draft or without IBAN", async () => {
    expect(await buildPreviewHtml(body())).not.toContain('class="girocode"');
    const noIban = structuredClone(backendRenderRequest) as RenderBody;
    delete noIban.data.company.iban;
    noIban.data.draft = false;
    noIban.data.number = "RE-2026-001";
    expect(await buildPreviewHtml(noIban)).not.toContain('class="girocode"');
  });
});
