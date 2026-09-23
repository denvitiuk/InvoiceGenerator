import { describe, expect, it } from "vitest";
import { invoicePdfFileName, safeFileNamePart } from "./safeFileName";

describe("invoicePdfFileName", () => {
  it("builds rechnung-<number>.pdf", () => {
    expect(invoicePdfFileName("RE-2026-0042")).toBe("rechnung-RE-2026-0042.pdf");
  });

  it("never lets '/' or other path/reserved characters through", () => {
    expect(invoicePdfFileName("RE/2026/0042")).toBe("rechnung-RE-2026-0042.pdf");
    expect(invoicePdfFileName("../../etc/passwd")).toBe("rechnung-etc-passwd.pdf");
    expect(invoicePdfFileName('A\\B:C*D?"E<F>G|H')).toBe("rechnung-A-B-C-D-E-F-G-H.pdf");
    expect(invoicePdfFileName("RE 2026\n0042")).toBe("rechnung-RE-2026-0042.pdf");
  });

  it("falls back to a plain name for an empty or unusable number", () => {
    expect(invoicePdfFileName("")).toBe("rechnung.pdf");
    expect(invoicePdfFileName("///")).toBe("rechnung.pdf");
    expect(invoicePdfFileName(null)).toBe("rechnung.pdf");
  });

  it("limits the length", () => {
    expect(safeFileNamePart("A".repeat(500)).length).toBe(100);
  });
});
