// Turns the Chromium-rendered invoice PDF into a ZUGFeRD 2.5.2 / Factur-X 1.09.2
// hybrid invoice: PDF/A-3 (conformance B) with the backend's XML embedded as
// factur-x.xml. Requirements implemented (FACTUR-X 1.09.2 DE, chapter 6):
//   6.1   PDF/A-3: XMP metadata with pdfaid:part=3/conformance=B, Info dictionary
//         equivalent to XMP, OutputIntent (GTS_PDFA1, ICC sRGB), trailer /ID, no
//         encryption, no JavaScript, printable annotations; fonts are already
//         embedded by Chromium.
//   6.2   embedded file "factur-x.xml", MIME text/xml, Params with ModDate,
//         listed in the EmbeddedFiles name tree and in the catalog /AF array
//         (document level), AFRelationship /Alternative (mandatory in Germany).
//   6.3   PDF/A extension schema "Factur-X PDFA Extension Schema" and the fx:
//         properties DocumentType=INVOICE, DocumentFileName=factur-x.xml,
//         Version=1.0, ConformanceLevel=EN 16931.
// Conformance is verified by the backend with veraPDF (PDF/A-3B) before the
// artifact is archived; this module never changes the XML bytes.
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
} from "pdf-lib";

export const FACTURX_NAMESPACE = "urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#";
export const ZUGFERD_XML_FILE_NAME = "factur-x.xml";
/** SHA-256 of server/assets/icc/sRGB2014.icc (ICC registry, 2015-02-15 revision). */
export const SRGB_ICC_SHA256 = "384b832de3412066743b52a75ee906b6fb9fb8d9e09e936fc2c43223815c6e0a";

export interface ZugferdPdfOptions {
  /** The exact CII XML from the backend (embedded unchanged). */
  xml: Uint8Array;
  /** fx:ConformanceLevel - "EN 16931" for this backend. */
  conformanceLevel: string;
  /** dc:title / Info Title, e.g. "Rechnung RE-2026-001". */
  title: string;
  /** dc:creator / Info Author (the seller). */
  author: string;
  /** dc:description / Info Subject. */
  subject: string;
  /** Creation time of the artifact (defaults to now). */
  now?: Date;
}

let iccCache: Uint8Array | null = null;

async function srgbProfile(): Promise<Uint8Array> {
  if (iccCache) return iccCache;
  const candidates = [
    path.join(process.cwd(), "server", "assets", "icc", "sRGB2014.icc"),
    path.join(process.cwd(), "web", "server", "assets", "icc", "sRGB2014.icc"),
  ];
  for (const file of candidates) {
    try {
      const bytes = new Uint8Array(await fs.readFile(file));
      const sha = createHash("sha256").update(bytes).digest("hex");
      if (sha !== SRGB_ICC_SHA256) throw new Error("sRGB ICC profile was modified");
      iccCache = bytes;
      return bytes;
    } catch (e: any) {
      if (e?.code !== "ENOENT") throw e;
    }
  }
  throw new Error("sRGB ICC profile (server/assets/icc/sRGB2014.icc) not found");
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** XMP date: UTC, second precision - the same instant pdf-lib writes into the Info dictionary. */
function xmpDate(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Visible-ASCII-safe PDF text strings: pdf-lib encodes non-ASCII Info strings as UTF-16BE itself. */
export function buildXmp(o: {
  title: string;
  author: string;
  subject: string;
  producer: string;
  creatorTool: string;
  date: Date;
  conformanceLevel: string;
}): string {
  const date = xmpDate(o.date);
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" rdf:about="">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" rdf:about="">
      <dc:format>application/pdf</dc:format>
      <dc:title>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${xmlEscape(o.title)}</rdf:li>
        </rdf:Alt>
      </dc:title>
      <dc:creator>
        <rdf:Seq>
          <rdf:li>${xmlEscape(o.author)}</rdf:li>
        </rdf:Seq>
      </dc:creator>
      <dc:description>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${xmlEscape(o.subject)}</rdf:li>
        </rdf:Alt>
      </dc:description>
    </rdf:Description>
    <rdf:Description xmlns:pdf="http://ns.adobe.com/pdf/1.3/" rdf:about="">
      <pdf:Producer>${xmlEscape(o.producer)}</pdf:Producer>
    </rdf:Description>
    <rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" rdf:about="">
      <xmp:CreatorTool>${xmlEscape(o.creatorTool)}</xmp:CreatorTool>
      <xmp:CreateDate>${date}</xmp:CreateDate>
      <xmp:ModifyDate>${date}</xmp:ModifyDate>
      <xmp:MetadataDate>${date}</xmp:MetadataDate>
    </rdf:Description>
    <rdf:Description xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#" rdf:about="">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>${FACTURX_NAMESPACE}</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentFileName</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The name of the embedded XML document</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentType</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The type of the hybrid document in capital letters, e.g. INVOICE or ORDER</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>Version</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The actual version of the standard applying to the embedded XML document</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>ConformanceLevel</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The conformance level of the embedded XML document</pdfaProperty:description>
                </rdf:li>
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
    <rdf:Description xmlns:fx="${FACTURX_NAMESPACE}" rdf:about="">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>${ZUGFERD_XML_FILE_NAME}</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>${xmlEscape(o.conformanceLevel)}</fx:ConformanceLevel>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

const PRODUCER = "Invoice Generator (pdf-lib 1.17.1)";
const CREATOR_TOOL = "Invoice Generator (Chromium)";

/** Annotation flags: Print (4) set; Invisible (1), Hidden (2), NoView (32), ToggleNoView (256) cleared. */
function fixAnnotationFlags(doc: PDFDocument) {
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookupMaybe(i, PDFDict);
      if (!annot) continue;
      const current = annot.lookupMaybe(PDFName.of("F"), PDFNumber)?.asNumber() ?? 0;
      annot.set(PDFName.of("F"), PDFNumber.of((current | 4) & ~(1 | 2 | 32 | 256)));
    }
  }
}

export async function toZugferdPdfA3(pdfBytes: Uint8Array, o: ZugferdPdfOptions): Promise<Uint8Array> {
  const now = new Date(Math.floor((o.now ?? new Date()).getTime() / 1000) * 1000);
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  if (doc.isEncrypted) throw new Error("Encrypted PDFs cannot become PDF/A");
  const context = doc.context;
  const catalog = doc.catalog;

  // PDF/A-3 is based on PDF 1.7 (associated files, AFRelationship).
  (context as any).header = (context.header.constructor as any).forVersion(1, 7);

  // No active content (PDF/A 6.6): drop document-level JavaScript and actions.
  catalog.delete(PDFName.of("AA"));
  catalog.delete(PDFName.of("OpenAction"));
  const names = catalog.lookupMaybe(PDFName.of("Names"), PDFDict) ?? context.obj({});
  names.delete(PDFName.of("JavaScript"));
  fixAnnotationFlags(doc);

  // Info dictionary, equivalent to the XMP below (PDF/A 6.6.2.3).
  const infoRef = context.trailerInfo.Info;
  const info = infoRef ? context.lookupMaybe(infoRef, PDFDict) : undefined;
  if (info) for (const key of info.keys()) info.delete(key);
  doc.setTitle(o.title);
  doc.setAuthor(o.author);
  doc.setSubject(o.subject);
  doc.setCreator(CREATOR_TOOL);
  doc.setProducer(PRODUCER);
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  // XMP metadata (uncompressed, PDF/A 6.6.2.1).
  const xmp = buildXmp({
    title: o.title,
    author: o.author,
    subject: o.subject,
    producer: PRODUCER,
    creatorTool: CREATOR_TOOL,
    date: now,
    conformanceLevel: o.conformanceLevel,
  });
  const metadata = context.stream(new TextEncoder().encode(xmp), { Type: "Metadata", Subtype: "XML" });
  catalog.set(PDFName.of("Metadata"), context.register(metadata));

  // OutputIntent with the ICC sRGB profile (PDF/A 6.2.3).
  const icc = context.flateStream(await srgbProfile(), { N: 3 });
  const outputIntent = context.obj({
    Type: "OutputIntent",
    S: "GTS_PDFA1",
    OutputConditionIdentifier: PDFString.of("sRGB IEC61966-2.1"),
    Info: PDFString.of("sRGB IEC61966-2.1"),
    RegistryName: PDFString.of("http://www.color.org"),
    DestOutputProfile: context.register(icc),
  });
  catalog.set(PDFName.of("OutputIntents"), context.obj([context.register(outputIntent)]));

  // factur-x.xml as associated file of the whole document (Factur-X 6.2).
  const date = PDFString.fromDate(now);
  const embedded = context.flateStream(o.xml, {
    Type: "EmbeddedFile",
    Subtype: "text/xml",
    Params: { Size: o.xml.length, CreationDate: date, ModDate: date },
  });
  const embeddedRef = context.register(embedded);
  const fileSpec = context.obj({
    Type: "Filespec",
    F: PDFString.of(ZUGFERD_XML_FILE_NAME),
    UF: PDFHexString.fromText(ZUGFERD_XML_FILE_NAME),
    EF: { F: embeddedRef, UF: embeddedRef },
    Desc: PDFString.of("Factur-X/ZUGFeRD invoice (EN 16931)"),
    AFRelationship: "Alternative",
  });
  const fileSpecRef = context.register(fileSpec);
  names.set(PDFName.of("EmbeddedFiles"), context.obj({ Names: [PDFString.of(ZUGFERD_XML_FILE_NAME), fileSpecRef] }));
  catalog.set(PDFName.of("Names"), names);
  catalog.set(PDFName.of("AF"), context.obj([fileSpecRef]));

  // Trailer /ID (PDF/A 6.1.3).
  const id = createHash("sha256").update(pdfBytes).update(o.xml).digest("hex").slice(0, 32);
  context.trailerInfo.ID = context.obj([PDFHexString.of(id), PDFHexString.of(id)]);

  return doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}
