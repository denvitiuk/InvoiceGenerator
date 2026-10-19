// E-invoicing fields of the backend's render body (connected mode).
//
// The Zeiterfassung backend builds ONE ElectronicInvoiceSnapshot per invoice and
// derives both the XML (ZUGFeRD 2.5.2 EN 16931 / XRechnung 3.0.2 CII) and this
// render body from it. The generator never builds or changes the XML: for a final
// ZUGFeRD invoice it embeds the backend's exact bytes (xmlBase64) into a PDF/A-3.
import { createHash } from "node:crypto";

export type ElectronicInvoiceFormat = "PDF" | "ZUGFERD_EN16931" | "XRECHNUNG_CII";

export interface ElectronicInvoiceInfo {
  format: ElectronicInvoiceFormat;
  standard: string;
  version?: string;
  profile?: string;
  xmlFileName?: string;
  /** fx:ConformanceLevel, final ZUGFeRD only ("EN 16931"). */
  conformanceLevel?: string;
  /** Exact XML bytes, base64 - final ZUGFeRD only. */
  xmlBase64?: string;
  xmlSha256?: string;
}

export interface InvoiceReferences {
  buyerReference?: string;
  leitwegId?: string;
  orderReference?: string;
  contractReference?: string;
  projectReference?: string;
}

const FORMATS: ElectronicInvoiceFormat[] = ["PDF", "ZUGFERD_EN16931", "XRECHNUNG_CII"];
const REFERENCE_KEYS: (keyof InvoiceReferences)[] = [
  "buyerReference",
  "leitwegId",
  "orderReference",
  "contractReference",
  "projectReference",
];

function text(raw: unknown, max: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return v ? v.slice(0, max) : undefined;
}

export function normalizeReferences(raw: unknown): InvoiceReferences | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: InvoiceReferences = {};
  for (const key of REFERENCE_KEYS) {
    const v = text((raw as any)[key], 200);
    if (v) out[key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function normalizeElectronicInvoice(raw: unknown): ElectronicInvoiceInfo | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as any;
  const format = FORMATS.find((f) => f === r.format);
  if (!format) return undefined;
  const xmlBase64 = typeof r.xmlBase64 === "string" && /^[A-Za-z0-9+/=]+$/.test(r.xmlBase64) ? r.xmlBase64 : undefined;
  const xmlSha256 = typeof r.xmlSha256 === "string" && /^[0-9a-f]{64}$/.test(r.xmlSha256) ? r.xmlSha256 : undefined;
  return {
    format,
    standard: text(r.standard, 40) ?? format,
    version: text(r.version, 20),
    profile: text(r.profile, 80),
    xmlFileName: text(r.xmlFileName, 120),
    conformanceLevel: text(r.conformanceLevel, 40),
    xmlBase64,
    xmlSha256,
  };
}

/** Label printed on the PDF, e.g. "ZUGFeRD 2.5.2 (EN 16931)" or "XRechnung 3.0.2". */
export function electronicInvoiceLabel(info: ElectronicInvoiceInfo | undefined): string {
  if (!info || info.format === "PDF") return "";
  if (info.format === "ZUGFERD_EN16931") return `${info.standard} ${info.version ?? ""} (EN 16931)`.replace(/\s+/g, " ").trim();
  return `${info.standard} ${info.version ?? ""}`.trim();
}

export class EmbeddedXmlError extends Error {}

/**
 * The XML to embed into a final ZUGFeRD PDF: decoded from the body and checked
 * against the backend's SHA-256, so a truncated/altered body is never embedded.
 * Returns null when the body is not a final ZUGFeRD invoice.
 */
export function zugferdXmlToEmbed(info: ElectronicInvoiceInfo | undefined, draft: boolean): Buffer | null {
  if (!info || info.format !== "ZUGFERD_EN16931" || draft) return null;
  if (!info.xmlBase64 || !info.xmlSha256) {
    throw new EmbeddedXmlError("A final ZUGFeRD invoice needs electronicInvoice.xmlBase64 and xmlSha256");
  }
  const xml = Buffer.from(info.xmlBase64, "base64");
  const sha = createHash("sha256").update(xml).digest("hex");
  if (sha !== info.xmlSha256) throw new EmbeddedXmlError("electronicInvoice.xmlBase64 does not match xmlSha256");
  if (info.xmlFileName && info.xmlFileName !== "factur-x.xml") {
    throw new EmbeddedXmlError("ZUGFeRD EN 16931 embeds the XML as factur-x.xml");
  }
  return xml;
}
