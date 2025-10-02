import type { Express, Request, Response } from "express";
import * as path from "node:path";
import { renderInvoiceHtml } from "../lib/template.js";
import { renderPdf } from "../lib/pdf.js";
import { nextNumber } from "../lib/seq.js";
import type { InvoiceData } from "../types/invoice.js";

function normalizeInvoice(data: Partial<InvoiceData> | undefined): InvoiceData {
  const d = (data || {}) as Partial<InvoiceData>;
  const todayIso = new Date().toISOString().slice(0, 10);

  // keep period only when BOTH dates are valid
  const fromISO = d.servicePeriod?.fromISO;
  const toISO = d.servicePeriod?.toISO;
  const hasFrom = !!fromISO && !Number.isNaN(new Date(String(fromISO)).getTime());
  const hasTo = !!toISO && !Number.isNaN(new Date(String(toISO)).getTime());
  const period = hasFrom && hasTo ? { fromISO: String(fromISO), toISO: String(toISO) } : undefined;

  return {
    language: (d.language as any) || "en",
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

export default function registerRender(app: Express) {
  // Render a single PDF for the given invoice JSON
  app.post("/render", async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as any;
      const raw = (body.data ?? body) as Partial<InvoiceData>; // accept {data:{...}} or plain invoice JSON
      const language = (body.language ?? raw.language ?? "en") as any;

      // Normalize input to avoid "Invalid time value" and other shape issues
      let data = normalizeInvoice(raw);

      // Assign invoice number if missing
      if (!data.number || String(data.number).trim() === "") {
        const { number } = await nextNumber({ scope: "month", pad: 4 });
        data = { ...data, number };
      }

      // Build HTML with inline styles for consistent PDF look
      const html = await renderInvoiceHtml({ ...data, language }, { inlineStyles: true });

      // Output file path and name
      const fname = `rechnung-${data.number}${language ? `-${language}` : ""}.pdf`;
      const outPath = path.join(process.cwd(), "out", fname);

      const abs = await renderPdf({ html, outPath });

      // If ?download=1, stream file; otherwise return JSON with file path
      if (String(req.query.download ?? "0") === "1") {
        res.download(abs, fname);
      } else {
        res.json({ ok: true, file: abs, name: fname, number: data.number, language: language ?? "de" });
      }
    } catch (e: any) {
      res.status(400).json({ error: e?.message ?? "Render error" });
    }
  });
}