// ZUGFeRD 2.5.2 (EN 16931) / XRechnung 3.0.2 rendering of the backend's FINAL
// render bodies. The fixtures are real bodies produced by the backend test
// InvoiceElectronicRoutesTest (synthetic master data, number RE-2026-001):
//  - backendZugferdFinalRenderRequest.json   carries the exact CII XML (xmlBase64)
//  - backendXRechnungFinalRenderRequest.json visual copy, the XML stays in the backend
// The generator never changes the XML; it embeds it into a PDF/A-3 as factur-x.xml.
// PDF/A-3 conformance itself is verified by veraPDF in the backend
// (EInvoicePdfArtifactTest), using a PDF produced by this test (EINVOICE_PDF_OUT).
import * as fs from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, decodePDFRawStream } from "pdf-lib";
import handler, { buildPreviewHtml } from "../../../pages/api/render";
import { EmbeddedXmlError, electronicInvoiceLabel, normalizeElectronicInvoice, normalizeReferences, zugferdXmlToEmbed } from "../../../server/lib/einvoice";
import { FACTURX_NAMESPACE, buildXmp, toZugferdPdfA3 } from "../../../server/lib/pdfa3";
import zugferdBody from "../testing/backendZugferdFinalRenderRequest.json";
import xrechnungBody from "../testing/backendXRechnungFinalRenderRequest.json";

type RenderBody = { data: Record<string, any>; language: string };
const clone = <T,>(v: T): T => structuredClone(v);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/[\s  ]+/g, " ");

function fixtureXml(): Buffer {
  return Buffer.from((zugferdBody as RenderBody).data.electronicInvoice.xmlBase64, "base64");
}

/** Reads what a recipient reads: the factur-x.xml filespec of the catalog /AF array. */
async function inspect(pdf: Uint8Array) {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const catalog = doc.catalog;
  const af = catalog.lookup(PDFName.of("AF"), PDFArray);
  const spec = af.lookup(0, PDFDict);
  const ef = spec.lookup(PDFName.of("EF"), PDFDict);
  const stream = ef.lookup(PDFName.of("F")) as PDFRawStream;
  const params = stream.dict.lookup(PDFName.of("Params"), PDFDict);
  const names = catalog.lookup(PDFName.of("Names"), PDFDict).lookup(PDFName.of("EmbeddedFiles"), PDFDict).lookup(PDFName.of("Names"), PDFArray);
  const metadata = catalog.lookup(PDFName.of("Metadata")) as PDFRawStream;
  const intent = catalog.lookup(PDFName.of("OutputIntents"), PDFArray).lookup(0, PDFDict);
  return {
    header: Buffer.from(pdf.subarray(0, 8)).toString("latin1"),
    fileName: spec.lookup(PDFName.of("F"), PDFString).decodeText(),
    unicodeFileName: spec.lookup(PDFName.of("UF"), PDFHexString).decodeText(),
    afRelationship: spec.lookup(PDFName.of("AFRelationship"), PDFName).asString(),
    mimeType: stream.dict.lookup(PDFName.of("Subtype"), PDFName).decodeText(),
    hasModDate: !!params.lookup(PDFName.of("ModDate")),
    xml: Buffer.from(decodePDFRawStream(stream).decode()),
    nameTreeKey: names.lookup(0, PDFString).decodeText(),
    nameTreeRefIsAf: names.get(1) === af.get(0),
    xmp: Buffer.from(metadata.getContents()).toString("utf8"),
    xmpFiltered: !!metadata.dict.lookup(PDFName.of("Filter")),
    outputIntentS: intent.lookup(PDFName.of("S"), PDFName).asString(),
    hasTrailerId: !!doc.context.trailerInfo.ID,
    title: doc.getTitle(),
    author: doc.getAuthor(),
    encrypted: doc.isEncrypted,
  };
}

describe("backend e-invoice fields", () => {
  it("normalizes references and the e-invoice block defensively", () => {
    expect(normalizeReferences({ leitwegId: " 04011000-12345-03 ", orderReference: "", foo: "x" })).toEqual({ leitwegId: "04011000-12345-03" });
    expect(normalizeReferences(undefined)).toBeUndefined();
    expect(normalizeElectronicInvoice({ format: "UBL" })).toBeUndefined();
    const info = normalizeElectronicInvoice((zugferdBody as RenderBody).data.electronicInvoice)!;
    expect(info.format).toBe("ZUGFERD_EN16931");
    expect(electronicInvoiceLabel(info)).toBe("ZUGFeRD 2.5.2 (EN 16931)");
    expect(electronicInvoiceLabel(normalizeElectronicInvoice((xrechnungBody as RenderBody).data.electronicInvoice))).toBe("XRechnung 3.0.2");
  });

  it("embeds only the backend's exact XML, checked against its SHA-256", () => {
    const info = normalizeElectronicInvoice((zugferdBody as RenderBody).data.electronicInvoice)!;
    const xml = zugferdXmlToEmbed(info, false)!;
    expect(createHash("sha256").update(xml).digest("hex")).toBe(info.xmlSha256);
    expect(xml.toString("utf8")).toContain("<ram:ID>urn:cen.eu:en16931:2017</ram:ID>");
    // drafts, XRechnung visual copies and plain PDFs embed nothing
    expect(zugferdXmlToEmbed(info, true)).toBeNull();
    expect(zugferdXmlToEmbed(normalizeElectronicInvoice((xrechnungBody as RenderBody).data.electronicInvoice), false)).toBeNull();
    // an altered body is refused instead of embedding a different XML
    expect(xml.toString("utf8")).toContain("<ram:GrandTotalAmount>217.15<");
    const tampered = { ...info, xmlBase64: Buffer.from(xml.toString("utf8").replace("<ram:GrandTotalAmount>217.15<", "<ram:GrandTotalAmount>219.15<")).toString("base64") };
    expect(() => zugferdXmlToEmbed(tampered, false)).toThrow(EmbeddedXmlError);
    expect(() => zugferdXmlToEmbed({ ...info, xmlBase64: undefined }, false)).toThrow(EmbeddedXmlError);
    expect(() => zugferdXmlToEmbed({ ...info, xmlFileName: "xrechnung.xml" }, false)).toThrow(EmbeddedXmlError);
  });

  it("prints number, dates, parties, references, totals and the e-invoice format from the same body", async () => {
    const zf = text(await buildPreviewHtml(clone(zugferdBody)));
    expect(zf).toContain("RE-2026-001");
    expect(zf).toContain("Glanz Gebäudeservice GmbH");
    expect(zf).toContain("Hausverwaltung Nord GmbH");
    expect(zf).toContain("30.09.2026");
    expect(zf).toContain("14.10.2026");
    expect(zf).toContain("E-Rechnung ZUGFeRD 2.5.2 (EN 16931)");
    expect(zf).toContain("Die strukturierten Rechnungsdaten (factur-x.xml) sind in diese PDF-Datei eingebettet.");
    expect(zf).toContain("217,15 €");
    expect(zf).not.toContain("ENTWURF");

    const xr = text(await buildPreviewHtml(clone(xrechnungBody)));
    expect(xr).toContain("Leitweg-ID: 04011000-12345-03");
    expect(xr).toContain("E-Rechnung XRechnung 3.0.2");
    expect(xr).not.toContain("factur-x.xml");
    const en = text(await buildPreviewHtml({ ...clone(xrechnungBody), language: "en", data: { ...clone(xrechnungBody).data, language: "en" } }));
    expect(en).toContain("E-invoice XRechnung 3.0.2");
  });

  it("escapes references so they never become markup", async () => {
    const body = clone(xrechnungBody) as RenderBody;
    body.data.references = { orderReference: "<script>alert(1)</script>" };
    const html = await buildPreviewHtml(body);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("PDF/A-3 conversion (Factur-X 1.09.2 chapter 6)", () => {
  async function samplePdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    return doc.save();
  }

  it("embeds factur-x.xml as associated file with AFRelationship Alternative, XMP and OutputIntent", async () => {
    const xml = fixtureXml();
    const out = await toZugferdPdfA3(await samplePdf(), {
      xml, conformanceLevel: "EN 16931", title: "Rechnung RE-2026-001", author: "Glanz Gebäudeservice GmbH",
      subject: "Rechnung RE-2026-001 (ZUGFeRD 2.5.2, EN 16931)", now: new Date("2026-09-30T10:00:00Z"),
    });
    const r = await inspect(out);
    expect(r.header).toBe("%PDF-1.7");
    expect(r.fileName).toBe("factur-x.xml");
    expect(r.unicodeFileName).toBe("factur-x.xml");
    expect(r.nameTreeKey).toBe("factur-x.xml");
    expect(r.nameTreeRefIsAf).toBe(true);
    expect(r.afRelationship).toBe("/Alternative");
    expect(r.mimeType).toBe("text/xml");
    expect(r.hasModDate).toBe(true);
    expect(r.xml.equals(xml)).toBe(true); // byte for byte
    expect(r.xmpFiltered).toBe(false);
    expect(r.xmp).toContain("<pdfaid:part>3</pdfaid:part>");
    expect(r.xmp).toContain("<pdfaid:conformance>B</pdfaid:conformance>");
    expect(r.xmp).toContain(`<pdfaSchema:namespaceURI>${FACTURX_NAMESPACE}</pdfaSchema:namespaceURI>`);
    expect(r.xmp).toContain("<fx:DocumentType>INVOICE</fx:DocumentType>");
    expect(r.xmp).toContain("<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>");
    expect(r.xmp).toContain("<fx:Version>1.0</fx:Version>");
    expect(r.xmp).toContain("<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>");
    expect(r.xmp).toContain("<xmp:CreateDate>2026-09-30T10:00:00Z</xmp:CreateDate>");
    expect(r.outputIntentS).toBe("/GTS_PDFA1");
    expect(r.hasTrailerId).toBe(true);
    expect(r.title).toBe("Rechnung RE-2026-001");
    expect(r.author).toBe("Glanz Gebäudeservice GmbH");
    expect(r.encrypted).toBe(false);
  });

  it("escapes XMP text values", () => {
    const xmp = buildXmp({ title: "A & B <x>", author: "\"Q\"", subject: "s", producer: "p", creatorTool: "c", date: new Date(0), conformanceLevel: "EN 16931" });
    expect(xmp).toContain("A &amp; B &lt;x&gt;");
    expect(xmp).toContain("&quot;Q&quot;");
  });
});

// Full /api/render path incl. headless Chrome (local Chrome as in dev; skipped elsewhere).
const hasLocalChrome =
  process.platform === "darwin" && fs.existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");

async function render(body: unknown) {
  const headers: Record<string, string> = {};
  let status = 0;
  let payload: Buffer = Buffer.alloc(0);
  const res: any = {
    setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; },
    status: (code: number) => { status = code; return res; },
    json: (v: unknown) => { payload = Buffer.from(JSON.stringify(v)); return res; },
    end: (b?: Buffer) => { if (b) payload = b; return res; },
  };
  await handler({ method: "POST", url: "/api/render", headers: { host: "localhost" }, query: {}, body } as any, res);
  return { status, headers, payload };
}

describe("backend final render body -> /api/render", () => {
  it.skipIf(!hasLocalChrome)("ZUGFeRD: returns a PDF/A-3 with the backend XML embedded as factur-x.xml", async () => {
    const { status, headers, payload } = await render(clone(zugferdBody));
    expect(status, payload.toString("utf8").slice(0, 300)).toBe(200);
    expect(headers["content-type"]).toBe("application/pdf");
    expect(headers["content-disposition"]).toContain('filename="zugferd-RE-2026-001.pdf"');
    const r = await inspect(payload);
    expect(r.xml.equals(fixtureXml())).toBe(true);
    expect(r.afRelationship).toBe("/Alternative");
    expect(r.xmp).toContain("<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>");
    expect(r.title).toBe("Rechnung RE-2026-001");
    const out = process.env.EINVOICE_PDF_OUT;
    if (out) fs.writeFileSync(out, payload);
  }, 60_000);

  it.skipIf(!hasLocalChrome)("XRechnung: renders the visual copy as a plain PDF without an embedded XML", async () => {
    const { status, headers, payload } = await render(clone(xrechnungBody));
    expect(status).toBe(200);
    expect(headers["content-disposition"]).toContain('filename="invoice-RE-2026-001.pdf"');
    const doc = await PDFDocument.load(payload, { updateMetadata: false });
    expect(doc.catalog.lookup(PDFName.of("AF"))).toBeUndefined();
    const out = process.env.EINVOICE_XR_PDF_OUT;
    if (out) fs.writeFileSync(out, payload);
  }, 60_000);

  it("refuses a final ZUGFeRD body whose XML does not match its SHA-256", async () => {
    const body = clone(zugferdBody) as RenderBody;
    body.data.electronicInvoice.xmlBase64 = Buffer.from("<x/>").toString("base64");
    const { status, payload } = await render(body);
    expect(status).toBe(400);
    expect(payload.toString("utf8")).toContain("xmlSha256");
  });
});
