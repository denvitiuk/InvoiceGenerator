// Connected-mode debug logger. Unlike AppShell's existing `dbg()` (which accepts
// arbitrary objects), this only ever accepts an explicit allowlist of primitive
// fields — a structural guard against ever accidentally logging a token, key,
// nonce, ciphertext, or PII. Crypto/vault/document codec modules must never
// import this (or console.*) at all; this is only for session/mapping-level
// diagnostics that are safe by construction.

type PrimitiveValue = string | number | boolean | null | undefined;

export function cdbg(event: string, fields?: Record<string, PrimitiveValue>): void {
  if (process.env.NODE_ENV === "production") return;
  const safeFields: Record<string, PrimitiveValue> = {};
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (
        value === null ||
        value === undefined ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        safeFields[key] = value;
      }
    }
  }
  // eslint-disable-next-line no-console
  console.log("[connected]", event, safeFields);
}
