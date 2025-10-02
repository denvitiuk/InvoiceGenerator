import type { Express, Request, Response } from "express";
import { chromium } from "playwright";
import { renderHTML } from "../lib/template.js";
import type { InvoiceData, Lang } from "../types/invoice.js";

// Normalize inbound payload so preview never crashes on half-empty data
function normalizeInvoice(data: Partial<InvoiceData> | undefined): InvoiceData {
  const d = (data || {}) as Partial<InvoiceData>;
  const todayIso = new Date().toISOString().slice(0, 10);

  // keep service period only when BOTH dates exist and are valid ISO
  const fromISO = d.servicePeriod?.fromISO;
  const toISO = d.servicePeriod?.toISO;
  const hasFrom = !!fromISO && !Number.isNaN(new Date(fromISO as string).getTime());
  const hasTo = !!toISO && !Number.isNaN(new Date(toISO as string).getTime());
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

export default function registerPreviewPdf(app: Express) {
  // POST is preferred to keep large payloads away from querystring
  app.post("/preview-pdf", async (req: Request, res: Response) => {
    try {
      const { data, language } = (req.body ?? {}) as { data?: Partial<InvoiceData>; language?: Lang };
      const safe = normalizeInvoice(data);
      const lang = (language as Lang) || safe.language || "en";

      // Ask template to inline styles (3rd arg is a legacy flag in our implementation)
      const html: string = await (renderHTML as any)(safe, lang, true);

      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle" });
        const pdfBuffer = await page.pdf({
          printBackground: true,
          preferCSSPageSize: true,
          format: "A4",
          margin: { top: "16mm", right: "12mm", bottom: "16mm", left: "12mm" },
        });

        res.status(200)
          .setHeader("Content-Type", "application/pdf")
          .setHeader("Cache-Control", "no-store")
          .setHeader("Content-Disposition", "inline; filename=preview.pdf")
          .send(Buffer.from(pdfBuffer));
      } finally {
        await browser.close();
      }
    } catch (err: any) {
      console.error("[preview-pdf] error", err);
      res
        .status(400)
        .json({ error: String(err?.message || err) });
    }
  });
}
