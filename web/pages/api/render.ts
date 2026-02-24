import type { NextApiRequest, NextApiResponse } from "next";
import { renderInvoiceHtml } from "../../server/lib/template";
import { getInvoiceStrings } from "../../server/lib/i18n";
import { InvoiceData } from "@/types/invoice";

export type Lang = "en" | "de" | "ru" | "bg" | "tr" | "uk";

// Increase body size limit and allow large binary responses (PDF)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
    responseLimit: false,
  },
};

function setCors(res: NextApiResponse) {
  // If your UI calls same-origin (/api/*), CORS is not required.
  // Keeping permissive headers matches the old Express behavior.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

const PDF_DEBUG = ["1", "true", "yes"].includes(String(process.env.PDF_DEBUG || "").toLowerCase());

function dbg(...args: any[]) {
  if (PDF_DEBUG) console.log("[render]", ...args);
}

// Keep behavior aligned with /api/preview
export function normalizeInvoice(data: Partial<InvoiceData> | undefined): InvoiceData {
  const d = (data || {}) as Partial<InvoiceData>;
  const todayIso = new Date().toISOString().slice(0, 10);

  const issueRaw = (d as any).issueDateISO;
  let issueDateISO = todayIso;
  if (issueRaw === "") {
    issueDateISO = "";
  } else if (issueRaw != null && String(issueRaw).trim()) {
    const v = String(issueRaw).trim();
    const ok = !Number.isNaN(new Date(v).getTime());
    issueDateISO = ok ? v : todayIso;
  }

  const fromISO = d.servicePeriod?.fromISO;
  const toISO = d.servicePeriod?.toISO;
  const hasFrom = !!fromISO && !Number.isNaN(new Date(String(fromISO)).getTime());
  const hasTo = !!toISO && !Number.isNaN(new Date(String(toISO)).getTime());
  const period = hasFrom && hasTo ? { fromISO: String(fromISO), toISO: String(toISO) } : undefined;

  return {
    language: (d.language as Lang) || "en",
    currency: d.currency || "EUR",
    number: d.number || "",
    issueDateISO,
    servicePeriod: period,
    dueDays: (() => {
      const raw = (d as any).dueDays;
      if (raw === "" || raw === undefined || raw === null) return undefined as any;
      const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
      if (!Number.isFinite(n) || n <= 0) return undefined as any;
      return n as any;
    })(),
    reverseCharge: !!(d as any).reverseCharge,
    kleinunternehmer: !!(d as any).kleinunternehmer,
    notes: Array.isArray(d.notes) ? d.notes : [],
    theme: (d as any).theme as any,
    object: typeof (d as any).object === "string" ? String((d as any).object).trim() : "",

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
      logoUrl: (d.company as any)?.logoUrl,
    },

    client: {
      name: d.client?.name || "—",
      addressLines: d.client?.addressLines || [],
      ustId: (d.client as any)?.ustId,
    },

    items:
      Array.isArray(d.items) && d.items.length
        ? (d.items as any)
        : [{ description: "", qty: 1, unit: "", unitPrice: 0, vatRate: 0 }],

    extraTables: d.extraTables || [],
    extraImages: d.extraImages || [],
  } as InvoiceData;
}

export async function buildPreviewHtml(input: any, baseUrl?: string): Promise<string> {
  const body = (input ?? {}) as any;
  const raw = (body.data ?? body) as Partial<InvoiceData>;
  const language = (body.language ?? (raw as any).language ?? "en") as Lang;
  const data = normalizeInvoice(raw);
  return renderInvoiceHtml({ ...data, language }, { inlineStyles: true, baseUrl });
}
function getBaseUrl(req: NextApiRequest): string {
  const proto = String((req.headers["x-forwarded-proto"] as any) || "http").split(",")[0].trim() || "http";
  const host = String((req.headers["x-forwarded-host"] as any) || req.headers.host || "localhost:3000").split(",")[0].trim();
  return `${proto}://${host}`;
}

async function htmlToPdfBuffer(html: string, opts: { footerTemplate: string }): Promise<Buffer> {
  const IS_LINUX = process.platform === "linux";
  const VERCEL_RAW = String(process.env.VERCEL || "").toLowerCase();
  const IS_VERCEL = VERCEL_RAW === "1" || VERCEL_RAW === "true";

  // Prefer Sparticuz only on Linux (Vercel/serverless). On macOS this often triggers spawn -8.
  const USE_SPARTICUZ = IS_LINUX && IS_VERCEL;

  dbg(`platform=${process.platform} arch=${process.arch} vercel=${IS_VERCEL} useSparticuz=${USE_SPARTICUZ}`);

  if (USE_SPARTICUZ) {
    // Vercel/Linux: puppeteer-core + @sparticuz/chromium
    const chromium = (await import("@sparticuz/chromium")).default as any;
    const puppeteer = (await import("puppeteer-core")).default as any;

    const execPath = await chromium.executablePath();
    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: execPath || undefined,
      headless: true,
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });

      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<div></div>",
        footerTemplate: opts.footerTemplate,
        margin: { top: "12mm", right: "12mm", bottom: "18mm", left: "12mm" },
      });

      await page.close();
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  // Local dev (macOS/Windows): prefer system Chrome via puppeteer-core.
  // This avoids common spawn issues with bundled browsers.
  const puppeteer = (await import("puppeteer-core")).default as any;

  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const winChrome1 = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const winChrome2 = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";

  let sysExec = "";
  try {
    const fs = await import("node:fs");
    if (process.platform === "darwin" && fs.existsSync(macChrome)) sysExec = macChrome;
    if (process.platform === "win32" && fs.existsSync(winChrome1)) sysExec = winChrome1;
    if (process.platform === "win32" && fs.existsSync(winChrome2)) sysExec = winChrome2;
  } catch {}

  if (sysExec) {
    dbg(`using system chrome: ${sysExec}`);
    const browser = await puppeteer.launch({
      executablePath: sysExec,
      headless: true,
      args: [],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });

      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<div></div>",
        footerTemplate: opts.footerTemplate,
        margin: { top: "12mm", right: "12mm", bottom: "18mm", left: "12mm" },
      });

      await page.close();
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  // Final fallback: Playwright (requires one-time browser install)
  dbg("system chrome not found; falling back to Playwright chromium");
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: "networkidle" as any });
    } catch {
      await page.setContent(html);
    }

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: opts.footerTemplate,
      margin: { top: "12mm", right: "12mm", bottom: "18mm", left: "12mm" },
    });

    await page.close();
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

function escapeHtml(s: string): string {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildFooterTemplate(inv: InvoiceData, pageLabel: string) {
  const leftParts: string[] = [];
  if (inv.company?.name) leftParts.push(escapeHtml(inv.company.name));
  if (inv.company?.website) leftParts.push(escapeHtml(inv.company.website));
  const left = leftParts.join(" · ");

  const right = `${escapeHtml(pageLabel)} <span class=\"pageNumber\"></span>/<span class=\"totalPages\"></span>`;

  // Puppeteer/Playwright header/footer templates must be self-contained HTML.
  return `
    <div style=\"font-size:9px;width:100%;padding:0 12mm;color:#666;display:flex;justify-content:space-between;\">
      <div>${left}</div>
      <div>${right}</div>
    </div>
  `;
}

function sanitizeFilename(name: string): string {
  const base = (name || "").replace(/[\r\n]/g, " ").replace(/[\\/]/g, " ").trim();
  return (base || "invoice").slice(0, 200);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setCors(res);
  dbg(`${req.method} ${req.url}`);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({ ok: true, route: "/api/render" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET,POST,OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const inv = normalizeInvoice(((req.body as any)?.data ?? req.body) as any);
    const dict = await getInvoiceStrings(inv.language);
    const pageLabel = (dict.page || "Page").toString();
    const footerTemplate = buildFooterTemplate(inv, pageLabel);

    const baseUrl = getBaseUrl(req);
    const html = await buildPreviewHtml(req.body, baseUrl);
    const pdf = await htmlToPdfBuffer(html, { footerTemplate });

    res.setHeader("Content-Type", "application/pdf");
    const inline =
      String((req.query as any)?.inline ?? "") === "1" ||
      String((req.body as any)?.inline ?? "") === "1" ||
      String((req.body as any)?.disposition ?? "").toLowerCase() === "inline";

    const baseName = sanitizeFilename(inv.number ? `invoice-${inv.number}` : "invoice");
    const filename = `${baseName}.pdf`;

    res.setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.setHeader("Content-Length", String(pdf.length));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    res.status(200);
    res.end(pdf);
    return;
  } catch (e: any) {
    console.error("[render] error", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}