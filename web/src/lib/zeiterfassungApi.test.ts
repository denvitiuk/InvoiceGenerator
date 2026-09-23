import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { makeWorkPackage } from "@/connected/testing/fixtures";

// The API base URL is read once at module load, so it must be set before the
// module is imported.
process.env.NEXT_PUBLIC_ZEITERFASSUNG_API_BASE = "https://api.test.internal";

let mod: typeof import("./zeiterfassungApi");

beforeAll(async () => {
  mod = await import("./zeiterfassungApi");
});

function mockFetchOnce(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

describe("zeiterfassungApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exchangeToken succeeds and returns the parsed response", async () => {
    const fetchMock = mockFetchOnce(200, {
      editorAccessToken: "tok_abc",
      invoiceId: "inv_1",
      accessExpiresAt: "2026-01-01T00:00:00Z",
      permissions: { read: true, edit: true, finalize: true },
    });
    vi.stubGlobal("fetch", fetchMock);

    const resp = await mod.exchangeToken({ token: "one-shot" });

    expect(resp.editorAccessToken).toBe("tok_abc");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.test.internal/invoicing/editor/exchange");
    expect(init.method).toBe("POST");
  });

  it("sends X-Editor-Token header on authenticated calls, never a query string", async () => {
    const fetchMock = mockFetchOnce(200, makeWorkPackage());
    vi.stubGlobal("fetch", fetchMock);

    await mod.getWorkPackage("editor-tok-xyz");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain("editor-tok-xyz");
    expect(init.headers["X-Editor-Token"]).toBe("editor-tok-xyz");
  });

  const statusCases: [number, string][] = [
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [429, "rate_limited"],
    [500, "server_error"],
    [503, "server_error"],
  ];

  for (const [status, kind] of statusCases) {
    it(`maps HTTP ${status} to EditorApiError kind "${kind}"`, async () => {
      vi.stubGlobal("fetch", mockFetchOnce(status, { message: "nope" }));

      await expect(mod.getWorkPackage("tok")).rejects.toMatchObject({
        name: "EditorApiError",
        status,
        kind,
      });
    });
  }

  it("maps a network failure to kind 'network_error' and never fakes success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(mod.getWorkPackage("tok")).rejects.toMatchObject({
      name: "EditorApiError",
      kind: "network_error",
    });
  });

  it("getVault treats 404 as 'no vault yet' (returns null, not an error)", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(404, { message: "not found" }));

    await expect(mod.getVault("tok")).resolves.toBeNull();
  });

  it("getDocument treats 404 as 'no document yet' (returns null, not an error)", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(404, { message: "not found" }));

    await expect(mod.getDocument("tok")).resolves.toBeNull();
  });

  it("reserveNumber and finalizeInvoice never silently succeed on a non-2xx response", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(409, { message: "revision mismatch" }));

    await expect(
      mod.reserveNumber("tok", { expectedRevision: 1, issueDate: "2026-01-01", dueDate: "2026-01-15" })
    ).rejects.toMatchObject({ kind: "conflict" });

    await expect(
      mod.finalizeInvoice("tok", {
        expectedRevision: 2,
        finalNetAmount: "100.00",
        finalVatAmount: "19.00",
        finalGrossAmount: "119.00",
      })
    ).rejects.toMatchObject({ kind: "conflict" });
  });
  it("number:override sends the token as a header only and returns the stored number", async () => {
    const fetchMock = mockFetchOnce(200, {
      invoiceNumber: "RE/2026/0042",
      revision: 5,
      status: "NUMBER_RESERVED",
      issueDate: "2026-09-23",
      dueDate: "2026-10-07",
      invoiceNumberSource: "MANUAL",
      invoiceNumberPatternSnapshot: null,
    });
    vi.stubGlobal("fetch", fetchMock);

    const resp = await mod.overrideNumber("editor-tok-xyz", {
      expectedRevision: 4,
      invoiceNumber: "RE/2026/0042",
      issueDate: "2026-09-23",
      dueDate: "2026-10-07",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.test.internal/invoicing/editor/number:override");
    expect(String(url)).not.toContain("editor-tok-xyz");
    expect(init.headers["X-Editor-Token"]).toBe("editor-tok-xyz");
    expect(JSON.parse(init.body)).toEqual({ expectedRevision: 4, invoiceNumber: "RE/2026/0042", issueDate: "2026-09-23", dueDate: "2026-10-07" });
    expect(resp).toMatchObject({ invoiceNumber: "RE/2026/0042", revision: 5, invoiceNumberSource: "MANUAL" });
  });

  it("a 409 on number:override surfaces the backend message and is never a success", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(409, { error: "Invoice number already in use" }));
    await expect(mod.overrideNumber("tok", { expectedRevision: 4, invoiceNumber: "RE-1" })).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
      serverMessage: "Invoice number already in use",
    });
  });

  it("a 2xx reservation without an actual number is rejected, never treated as reserved", async () => {
    vi.stubGlobal("fetch", mockFetchOnce(200, { revision: 5 }));
    await expect(mod.reserveNumber("tok", { expectedRevision: 4 })).rejects.toMatchObject({ kind: "invalid_contract" });
  });

  it("an incompatible work package is rejected with the offending fields", async () => {
    const { totals: _t, ...broken } = makeWorkPackage();
    vi.stubGlobal("fetch", mockFetchOnce(200, broken));
    await expect(mod.getWorkPackage("tok")).rejects.toMatchObject({ kind: "invalid_contract", serverMessage: expect.stringContaining("totals") });
  });
});
