

import type { Express, Request, Response } from "express";
import { renderInvoiceHtml } from "../lib/template.js";
import type { InvoiceData, Lang } from "../types/invoice.js";

// Make preview resilient to half-empty/invalid payloads
function normalizeInvoice(data: Partial<InvoiceData> | undefined): InvoiceData {
  const d = (data || {}) as Partial<InvoiceData>;
  const todayIso = new Date().toISOString().slice(0, 10);

  // keep service period only when BOTH dates are valid
  const fromISO = d.servicePeriod?.fromISO;
  const toISO = d.servicePeriod?.toISO;
  const hasFrom = !!fromISO && !Number.isNaN(new Date(String(fromISO)).getTime());
  const hasTo = !!toISO && !Number.isNaN(new Date(String(toISO)).getTime());
  const period = hasFrom && hasTo ? { fromISO: String(fromISO), toISO: String(toISO) } : undefined;

  return {
    language: (d.language as Lang) || "en",
    currency: d.currency || "EUR",
    number: d.number || "",
    issueDateISO: d.issueDateISO || todayIso,
    servicePeriod: period,
    dueDays: typeof d.dueDays === "number" ? d.dueDays : 0,
    reverseCharge: !!(d as any).reverseCharge,
    kleinunternehmer: !!(d as any).kleinunternehmer,
    notes: Array.isArray(d.notes) ? d.notes : [],

    company: {
      name: d.company?.name || "—",
      addressLines: d.company?.addressLines || [],
      email: d.company?.email,
      phone: d.company?.phone,
      website: d.company?.website,
      ustId: (d.company as any)?.ustId,
      steuerNr: (d.company as any)?.steuerNr,
      iban: d.company?.iban,
      bic: d.company?.bic,
      bankName: d.company?.bankName,
      logoPath: d.company?.logoPath,
    },

    client: {
      name: d.client?.name || "—",
      addressLines: d.client?.addressLines || [],
      ustId: (d.client as any)?.ustId,
    },

    items: Array.isArray(d.items) && d.items.length
      ? (d.items as any)
      : [{ description: "", qty: 1, unit: "", unitPrice: 0, vatRate: 0 }],

    extraTables: d.extraTables || [],
    extraImages: d.extraImages || [],
  } as InvoiceData;
}

export default function registerPreview(app: Express) {
  // HTML preview of the invoice (no file is written)
  app.post("/preview", async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as any;
      const raw = (body.data ?? body) as Partial<InvoiceData>; // accept either {data: {...}} or plain invoice JSON
      const language = (body.language ?? raw.language ?? "en") as Lang;

      const data = normalizeInvoice(raw);

      // Inline styles to make preview look exactly like final PDF
      const html = await renderInvoiceHtml({ ...data, language }, { inlineStyles: true });
      res.type("html").send(html);
    } catch (e: any) {
      // Do not 400 on preview — return minimal HTML so UI doesn't crash
      res
        .status(200)
        .type("html")
        .send(`<pre style="padding:12px;font-family:system-ui">Preview error: ${String(e?.message || e)}</pre>`);
    }
  });

  // Simple health/ready endpoint
  app.get("/preview/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
}