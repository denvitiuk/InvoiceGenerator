// Builds download file names from user/backend-controlled values (e.g. an
// invoice number like "RE/2026/0042") without letting any character act as a
// path separator or otherwise invalid file-name character. Only the file name
// is sanitized — the invoice number inside the document stays unchanged.

export function safeFileNamePart(raw: string | null | undefined, maxLength = 100): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, maxLength)
    .replace(/[-.]+$/g, "");
}

/** `rechnung-RE-2026-0042.pdf`; `rechnung.pdf` when the number is empty/unusable. */
export function invoicePdfFileName(invoiceNumber: string | null | undefined, prefix = "rechnung"): string {
  const part = safeFileNamePart(invoiceNumber);
  return part ? `${prefix}-${part}.pdf` : `${prefix}.pdf`;
}
