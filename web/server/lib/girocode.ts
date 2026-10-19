import QRCode from "qrcode";

/**
 * GiroCode = EPC QR code for SEPA credit transfers (EPC069-12, "BCD" version 002,
 * character set 1 = UTF-8, identification SCT). German banking apps (Deutsche Bank,
 * Sparkasse, Volksbank, ING, N26, ...) read it and pre-fill recipient, IBAN, BIC,
 * amount and the payment reference.
 *
 * Purely visual: it is built from data the invoice already prints (company name,
 * IBAN/BIC, gross total, number), so the backend's render body and its digest are
 * unchanged. Only for EUR and 0.01..999 999 999.99; otherwise there is no code.
 */
export interface GiroCodeInput {
  name: string;
  iban: string;
  bic?: string;
  currency: string;
  amountCents: number;
  remittance: string;
}

const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
const BIC = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
const MAX_CENTS = 99_999_999_999;

const clip = (value: string, max: number) => Array.from(value.replace(/\s+/g, " ").trim()).slice(0, max).join("");

/** The EPC payload, or null when a payment code cannot (or must not) be produced. */
export function epcPayload(input: GiroCodeInput): string | null {
  const iban = input.iban.replace(/\s+/g, "").toUpperCase();
  const bic = (input.bic ?? "").replace(/\s+/g, "").toUpperCase();
  const name = clip(input.name, 70);
  if (input.currency !== "EUR" || !IBAN.test(iban) || !name) return null;
  if (!Number.isInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > MAX_CENTS) return null;
  const amount = `EUR${Math.floor(input.amountCents / 100)}.${String(input.amountCents % 100).padStart(2, "0")}`;
  return [
    "BCD",
    "002",
    "1",
    "SCT",
    BIC.test(bic) ? bic : "",
    name,
    iban,
    amount,
    "", // purpose code
    "", // structured creditor reference (RF...) - the invoice number goes into the text below
    clip(input.remittance, 140),
  ].join("\n");
}

/** QR code as a self-contained SVG (error correction M, as EPC069-12 requires; 4-module quiet zone). */
export function qrSvg(text: string): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const quiet = 4;
  let path = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (qr.modules.get(y, x)) path += `M${x + quiet},${y + quiet}h1v1h-1z`;
    }
  }
  const box = size + quiet * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" shape-rendering="crispEdges">`
    + `<rect width="${box}" height="${box}" fill="#ffffff"/><path d="${path}" fill="#000000"/></svg>`;
}

/** SVG markup of the GiroCode, or null (see [epcPayload]). */
export function giroCodeSvg(input: GiroCodeInput): string | null {
  const payload = epcPayload(input);
  return payload ? qrSvg(payload) : null;
}
