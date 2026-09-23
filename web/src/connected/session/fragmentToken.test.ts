// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readInvoiceSessionToken } from "./fragmentToken";

describe("readInvoiceSessionToken", () => {
  beforeEach(() => {
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
  });

  it("extracts the token and strips the fragment via history.replaceState", () => {
    const location = {
      hash: "#invoice_session=abc123",
      href: "https://example.com/app#invoice_session=abc123",
    } as Location;

    const token = readInvoiceSessionToken(location);

    expect(token).toBe("abc123");
    expect(window.history.replaceState).toHaveBeenCalledTimes(1);
    const [, , strippedUrl] = (window.history.replaceState as any).mock.calls[0];
    expect(String(strippedUrl)).not.toContain("invoice_session");
    expect(String(strippedUrl)).not.toContain("abc123");
  });

  it("returns null and never touches history when there is no session fragment", () => {
    const location = { hash: "", href: "https://example.com/app" } as Location;

    const token = readInvoiceSessionToken(location);

    expect(token).toBeNull();
    expect(window.history.replaceState).not.toHaveBeenCalled();
  });

  it("ignores unrelated fragments", () => {
    const location = { hash: "#some-other-anchor", href: "https://example.com/app#some-other-anchor" } as Location;

    expect(readInvoiceSessionToken(location)).toBeNull();
    expect(window.history.replaceState).not.toHaveBeenCalled();
  });

  it("url-decodes the token", () => {
    const location = {
      hash: "#invoice_session=abc%2F123",
      href: "https://example.com/#invoice_session=abc%2F123",
    } as Location;

    expect(readInvoiceSessionToken(location)).toBe("abc/123");
  });
});
