// The Zeiterfassung backend's admin preview (POST /invoicing/invoices/{id}/preview)
// returns a `renderRequest` that is posted unchanged to /api/render. The fixture is
// a real body produced by the backend test InvoicePreviewRoutesTest (synthetic data).
// These tests pin that contract: everything the backend sends must reach the PDF.
import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import handler, { buildPreviewHtml } from "../../../pages/api/render";
import backendRenderRequest from "../testing/backendPreviewRenderRequest.json";

type RenderBody = { data: Record<string, any>; language: string };

function body(patch: Partial<RenderBody["data"]> = {}, language?: string): RenderBody {
  const base = structuredClone(backendRenderRequest) as RenderBody;
  const lang = language ?? base.language;
  return { data: { ...base.data, language: lang, ...patch }, language: lang };
}

/** Visible text: tags stripped, entities kept as-is, whitespace/NBSP collapsed. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/[\s  ]+/g, " ");
}

async function html(b: RenderBody): Promise<string> {
  return text(await buildPreviewHtml(b));
}

describe("backend preview renderRequest -> invoice template", () => {
  it("prints company, client, object, period, lines, VAT, notes and draft status (de)", async () => {
    const out = await html(body());
    // parties (& is escaped in markup, shown as & in the PDF)
    expect(out).toContain("Glanz &amp; Co. Gebäudeservice");
    expect(out).toContain("Hafenstraße 1");
    expect(out).toContain("USt-IdNr.: DE123456789");
    expect(out).toContain("Hausverwaltung Nord GmbH");
    expect(out).toContain("Mönckebergstraße 7");
    expect(out).toContain("Kundennummer: K-1001");
    expect(out).toContain("IBAN: DE89370400440532013000");
    // object, period, dates, payment term
    expect(out).toContain("Objekt: Objekt Nord — Hafenstr. 5");
    expect(out).toContain("Leistungszeitraum 01.09.2026 – 30.09.2026");
    expect(out).toContain("Rechnungsdatum 30.09.2026");
    expect(out).toContain("Fällig am 14.10.2026");
    expect(out).toContain("Zahlbar innerhalb von 14 Tagen");
    // automatic line: localized system group, date, people and unit
    expect(out).toContain("Reguläre Arbeitszeit");
    expect(out).toContain("Di, 15.09 · 1 Person · 8 Std. gesamt");
    expect(out).toMatch(/8 Std\. 20,00 € 19 % 30,40 € 160,00 €/);
    // manual line: admin text and unit printed as entered
    expect(out).toMatch(/Material costs 3 piece 25,00 € 19 % 14,25 € 75,00 €/);
    // totals are the backend's amounts
    expect(out).toContain("Nettobetrag 235,00 €");
    expect(out).toContain("MwSt. 19 % auf 235,00 € 44,65 €");
    expect(out).toContain("Gesamtbetrag 279,65 €");
    // admin notes, untranslated
    expect(out).toContain("Bitte Kundennummer angeben");
    // draft: watermark + notice, no number
    expect(out).toContain("ENTWURF");
    expect(out).toContain("Entwurf – noch keine gültige Rechnung");
    expect(out).not.toMatch(/\bhour\b/);
    expect(out).not.toContain("Regular working hours");
  });

  it("switches system labels, dates and units to the document language (en, ru)", async () => {
    const en = await html(body({}, "en"));
    expect(en).toContain("DRAFT");
    expect(en).toContain("Regular working hours");
    expect(en).toContain("Tue, 15.09 · 1 person · 8 h total");
    expect(en).toContain("Net amount €235.00");
    expect(en).toContain("Total amount €279.65");
    expect(en).toContain("Material costs"); // admin text unchanged
    expect(en).toContain("Bitte Kundennummer angeben"); // admin notes never translated

    const ru = await html(body({}, "ru"));
    expect(ru).toContain("ЧЕРНОВИК");
    expect(ru).toContain("Основное рабочее время");
    expect(ru).toContain("вт, 15.09 · 1 чел. · 8 ч всего");
    expect(ru).toContain("Material costs");
    expect(ru).not.toMatch(/\bhour\b/);
  });

  it("translates only backend system units - admin-typed units stay as entered", async () => {
    const [auto, manual] = (backendRenderRequest as RenderBody).data.items;
    const out = await html(body({
      items: [
        { ...auto, unit: "pauschal", qty: 1 },
        { ...manual, unit: "hour", description: "Manual hour line" }, // no serverDetails: admin input
      ],
    }, "en"));
    expect(out).toContain("flat rate");
    expect(out).toMatch(/Manual hour line 3 hour/);
  });

  it("a group with one line gets no heading row; two lines of a group share one heading", async () => {
    const [auto] = (backendRenderRequest as RenderBody).data.items;
    const single = await buildPreviewHtml(body({ items: [{ ...auto, group: "Mop the floor" }] }, "de"));
    expect(single).not.toContain('<tr class="item-group-row"');
    expect(single).toContain('<strong class="item-group-inline">Mop the floor</strong>');

    const shared = await buildPreviewHtml(body({
      items: [{ ...auto, group: "Mop the floor" }, { ...auto, serverItemId: "b", group: "Mop the floor" }],
    }, "de"));
    expect(shared.match(/<tr class="item-group-row"/g)?.length).toBe(1);

    const de = await html(body({ items: [{ ...auto, qty: 0.28, unit: "h" }] }, "de"));
    expect(de).toMatch(/gesamt 0,28 h/); // the quantity column, not just the description
    expect(shared).not.toContain('<strong class="item-group-inline"');
  });

  it("an empty draft shows 'no billable items' and no placeholder line", async () => {
    const out = await html(body({ items: [], notes: [] }));
    expect(out).toContain("Keine abrechenbaren Positionen");
    expect(out).toContain("ENTWURF");
    expect(out).not.toContain("Material costs");
    // the legacy placeholder row would print "1 0,00 € 0% 0,00 €"
    expect(out).not.toMatch(/\b1 0,00 € 0%/);
  });

  it("escapes billing details so they can never become markup in the PDF browser", async () => {
    const raw = await buildPreviewHtml(body({
      company: { name: "<img src=http://169.254.169.254/x>Evil", addressLines: ["<script>alert(1)</script>"] },
      client: { name: "\"><b>Client</b>", addressLines: [] },
      notes: ["<iframe src=x></iframe>"],
      object: "<svg onload=alert(1)>",
    }));
    expect(raw).not.toContain("<img src=http://169.254.169.254");
    expect(raw).not.toContain("<script>alert(1)</script>");
    expect(raw).not.toContain("<b>Client</b>");
    expect(raw).not.toContain("<iframe src=x>");
    expect(raw).not.toContain("<svg onload");
    expect(raw).toContain("&lt;img src=http://169.254.169.254/x&gt;Evil");
  });
});

// Full /api/render path incl. headless Chrome. Needs a local Chrome (as in dev);
// skipped elsewhere, e.g. CI without a browser.
const hasLocalChrome =
  process.platform === "darwin" && fs.existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");

describe("backend preview renderRequest -> /api/render PDF", () => {
  it.skipIf(!hasLocalChrome)("returns a real application/pdf document", async () => {
    const headers: Record<string, string> = {};
    let status = 0;
    let payload: Buffer = Buffer.alloc(0);
    const res: any = {
      setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; },
      status: (code: number) => { status = code; return res; },
      json: (v: unknown) => { payload = Buffer.from(JSON.stringify(v)); return res; },
      end: (b?: Buffer) => { if (b) payload = b; return res; },
    };
    const req: any = { method: "POST", url: "/api/render", headers: { host: "localhost" }, query: {}, body: body() };

    await handler(req, res);

    expect(status, payload.toString("utf8").slice(0, 200)).toBe(200);
    expect(headers["content-type"]).toBe("application/pdf");
    expect(payload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(payload.subarray(-8).toString("latin1")).toContain("%%EOF");
    expect(payload.length).toBeGreaterThan(5_000);
    // Draft preview: no number -> generic file name, never a guessed number.
    expect(headers["content-disposition"]).toContain('filename="invoice.pdf"');
  }, 60_000);
});
