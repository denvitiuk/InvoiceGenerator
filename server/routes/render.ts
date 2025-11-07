import type { Express, Request, Response } from "express";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { renderInvoiceHtml } from "../lib/template.js";
import { renderPdf, renderPdfBuffer } from "../lib/pdf.js";
import { nextNumber } from "../lib/seq.js";
import type { InvoiceData } from "../types/invoice.js";

// Vercel-safe output dirs
const OUT_DIR = path.resolve(process.cwd(), "out");
const TMP_OUT_DIR = path.resolve(process.env.TMPDIR || "/tmp", "out");

// tiny sanitizers
const s = (v: any) => (typeof v === "string" ? v.trim() : v == null ? undefined : String(v).trim());
const strArr = (v: any): string[] => Array.isArray(v) ? v.map((x) => s(x) || "").filter(Boolean) : [];
const cleanIban = (v: any) => (s(v)?.replace(/\s+/g, "") || undefined);
const cleanBic = (v: any) => (s(v)?.replace(/\s+/g, "").toUpperCase() || undefined);

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
      name: s(d.company?.name) || "—",
      addressLines: strArr(d.company?.addressLines),
      email: s(d.company?.email),
      phone: s(d.company?.phone),
      website: s(d.company?.website),
      ustId: s((d.company as any)?.ustId),
      steuerNr: s((d.company as any)?.steuerNr),
      iban: cleanIban(d.company?.iban),
      bic: cleanBic(d.company?.bic),
      bankName: s(d.company?.bankName),
      logoPath: s(d.company?.logoPath),
    },

    client: {
      name: s(d.client?.name) || "—",
      addressLines: strArr(d.client?.addressLines),
      ustId: s((d.client as any)?.ustId),
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

      // Optional custom filename from client
      const requestedNameRaw = (body.fileName ?? (raw as any)?.fileName ?? "").toString().trim();
      const sanitizeBaseName = (s: string) => s
        .replace(/\.[pP][dD][fF]$/g, "")   // drop .pdf if provided
        .replace(/[\\\/:*?"<>|]+/g, "") // forbidden FS chars
        .replace(/\s+/g, " ")              // collapse spaces
        .trim();
      const requestedBase = requestedNameRaw ? sanitizeBaseName(requestedNameRaw) : "";

      // Normalize input to avoid "Invalid time value" and other shape issues
      let data = normalizeInvoice(raw);

      // Assign invoice number if missing
      if (!data.number || String(data.number).trim() === "") {
        const { number } = await nextNumber({ scope: "month", pad: 4 });
        data = { ...data, number };
      }

      // Build HTML with inline styles for consistent PDF look
      const html = await renderInvoiceHtml({ ...data, language }, { inlineStyles: true });

      // If ?download=1, stream PDF directly (no /out file)
      if (String(req.query.download ?? "0") === "1") {
        const pdfBuf = await renderPdfBuffer({ html });
        const defaultName = `rechnung-${data.number}${language ? `-${language}` : ""}.pdf`;
        const fname = requestedBase ? `${requestedBase}.pdf` : defaultName;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
        res.setHeader("Content-Length", String(pdfBuf.byteLength));
        return res.end(pdfBuf);
      }

      // File-based fallback (kept for compatibility)
      const defaultName = `rechnung-${data.number}${language ? `-${language}` : ""}.pdf`;
      const fname = requestedBase ? `${requestedBase}.pdf` : defaultName;
      const baseOut = process.env.VERCEL ? TMP_OUT_DIR : OUT_DIR;
      await fs.mkdir(baseOut, { recursive: true });
      const outPath = path.join(baseOut, fname);
      const abs = await renderPdf({ html, outPath });
      res.json({ ok: true, file: abs, name: fname, number: data.number, language });
    } catch (e: any) {
      res.status(400).json({ error: e?.message ?? "Render error" });
    }
  });

  // Quick checks
  app.get("/render", (_req: Request, res: Response) => {
    res.type("html").send("<!doctype html><meta charset=\"utf-8\"><body>OK /render</body>");
  });
  app.get("/render/health", (_req: Request, res: Response) => res.json({ ok: true }));
}