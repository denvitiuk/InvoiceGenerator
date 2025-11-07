import type { Express, Request, Response } from "express";
import { renderHTML } from "../lib/template.js";
import type { InvoiceData, Lang } from "../types/invoice.js";

// --- tiny sanitizers to keep preview robust and avoid garbage in template ---
const s = (v: any) => (typeof v === "string" ? v.trim() : v == null ? undefined : String(v).trim());
const strArr = (v: any): string[] => Array.isArray(v) ? v.map((x) => s(x) || "").filter(Boolean) : [];
const cleanIban = (v: any) => (s(v)?.replace(/\s+/g, "") || undefined);
const cleanBic = (v: any) => (s(v)?.replace(/\s+/g, "").toUpperCase() || undefined);

// Normalize inbound payload so preview never crashes on half-empty data
function normalizeInvoice(data: Partial<InvoiceData> | undefined): InvoiceData {
  const d = (data || {}) as Partial<InvoiceData>;
  const todayIso = new Date().toISOString().slice(0, 10);

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

async function generatePdfFromHtml(html: string): Promise<Buffer> {
  if (process.env.VERCEL || process.env.USE_PUPPETEER === '1') {
    const chromiumModule: any = await import('@sparticuz/chromium');
    const puppeteerModule: any = await import('puppeteer-core');

    const chromium = chromiumModule.default ?? chromiumModule;
    const puppeteer = puppeteerModule.default ?? puppeteerModule;

    const executablePath = await chromium.executablePath();
    const browser = await puppeteer.launch({
      args: chromium.args ?? [],
      defaultViewport: chromium.defaultViewport ?? { width: 1280, height: 720 },
      executablePath,
      headless: "headless" in chromium ? chromium.headless : true,
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        printBackground: true,
        preferCSSPageSize: true,
        format: 'A4',
        margin: { top: '16mm', right: '12mm', bottom: '16mm', left: '12mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  const { chromium: pwChromium } = await import('playwright');
  const browser = await pwChromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdfBuffer = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      format: 'A4',
      margin: { top: '16mm', right: '12mm', bottom: '16mm', left: '12mm' },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

export default function registerPreviewPdf(app: Express) {
  app.post("/preview-pdf", async (req: Request, res: Response) => {
    try {
      const { data, language } = (req.body ?? {}) as { data?: Partial<InvoiceData>; language?: Lang };
      const safe = normalizeInvoice(data);
      const lang = (language as Lang) || safe.language || "en";

      const html: string = await (renderHTML as any)(safe, lang, true);
      const pdfBuffer = await generatePdfFromHtml(html);

      res.status(200)
          .setHeader("Content-Type", "application/pdf")
          .setHeader("Cache-Control", "no-store")
          .setHeader("Content-Disposition", "inline; filename=preview.pdf")
          .send(pdfBuffer);
    } catch (err: any) {
      console.error("[preview-pdf] error", err);
      res.status(400).json({ error: String(err?.message || err) });
    }
  });

  app.get("/preview-pdf/health", (_req: Request, res: Response) => res.json({ ok: true }));
}