// Decimal-string <-> number conversion helpers shared by the work-package mapping
// and the finalize sum computation, so both round the same way.
//
// The backend sends money/quantity as decimal strings to avoid float precision
// loss over the wire; InvoiceData/LineItem (this app's existing model) use plain
// `number`. We convert to `number` only at the UI boundary and format back to a
// decimal string only when sending a request — never round-tripping through a
// float more than once per direction.

export function decimalStringToNumber(value: string | undefined | null): number {
  if (value === undefined || value === null || value.trim() === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Formats a number back to a plain decimal string (no thousands separators, '.' decimal point). */
export function numberToDecimalString(value: number, maxFractionDigits = 2): string {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(maxFractionDigits);
}

export function addDecimalStrings(a: string, b: string, maxFractionDigits = 2): string {
  return numberToDecimalString(
    decimalStringToNumber(a) + decimalStringToNumber(b),
    maxFractionDigits
  );
}

export function sumDecimalStrings(values: (string | undefined | null)[], maxFractionDigits = 2): string {
  const total = values.reduce((sum, v) => sum + decimalStringToNumber(v ?? "0"), 0);
  return numberToDecimalString(total, maxFractionDigits);
}
