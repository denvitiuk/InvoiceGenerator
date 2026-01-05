import type { NextApiRequest, NextApiResponse } from "next";
import * as path from "node:path";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";

// @ts-ignore - no official types for archiver v7, treat as any
import archiver from "archiver";

import { renderInvoiceHtml } from "../../server/lib/template";
import { nextNumber } from "../../server/lib/seq";
import { SUPPORTED_LANGS, resolveLang, type Lang } from "../../server/lib/i18n";
import type { InvoiceData } from "@/types/invoice";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
    responseLimit: false,
  },
};

// Paths: in Next dev, cwd is usually /web; in old setup generation might have used repo root.
const OUT_DIR_WEB = path.resolve(process.cwd(), "out");
const OUT_DIR_REPO = path.resolve(process.cwd(), "..", "out");
const TMP_OUT_DIR = path.resolve(process.env.TMPDIR || "/tmp", "out");

const s = (v: any) => (typeof v === "string" ? v.trim() : v == null ? undefined : String(v).trim());
const strArr = (v: any): string[] => (Array.isArray(v) ? v.map((x) => s(x) || "").filter(Boolean) : []);
const cleanIban = (v: any) => (s(v)?.replace(/\s+/g, "") || undefined);
const cleanBic = (v: any) => (s(v)?.replace(/\s+/g, "").toUpperCase() || undefined);

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function setCors(res: NextApiResponse) {
  // Same-origin calls do not require CORS; keep permissive headers to match old Express behavior.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

const PDF_DEBUG = ["1", "true", "yes"].includes(String(process.env.PDF_DEBUG || "").toLowerCase());
function dbg(...args: any[]) {
  if (PDF_DEBUG) console.log("[render-all]", ...args);
}

function pickOutDir(): string {
  if (process.env.VERCEL) return TMP_OUT_DIR;
  // Prefer existing repo root out/ if present (matches old Express behavior), otherwise use web/out
  if (fs.existsSync(OUT_DIR_REPO)) return OUT_DIR_REPO;
  return OUT_DIR_WEB;
}

function normalizeInvoice(data: Partial<InvoiceData> | undefined): InvoiceData {
  const d = (data || {}) as Partial<InvoiceData>;
  const todayIso = new Date().toISOString().slice(0, 10);

  // Issue date optional: keep "" as empty (means: do not show), default to today when omitted.
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
    language: (d.language as any) || "en",
    currency: d.currency || "EUR",
    number: d.number || "",
    issueDateISO,
    servicePeriod: period,
    dueDays: (() => {
      const raw = (d as any).dueDays;
      // Optional Zahlungsziel:
      // - if client sends "" or null/undefined -> keep undefined (means: do not show)
      // - if a valid positive integer -> keep it
      // - 0 or negative -> treat as undefined (hide)
      if (raw === "" || raw === undefined || raw === null) return undefined as any;
      const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
      if (!Number.isFinite(n) || n <= 0) return undefined as any;
      return n as any;
    })(),
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

    items:
      Array.isArray(d.items) && d.items.length
        ? (d.items as any)
        : [{ description: "", qty: 1, unit: "", unitPrice: 0, vatRate: 0 }],

    extraTables: (d as any).extraTables || [],
    extraImages: (d as any).extraImages || [],
  } as InvoiceData;
}

function sanitizeZipBaseName(input: string): string {
  return (input || "")
    .replace(/\.zip$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function htmlToPdfBuffer(html: string): Promise<Buffer> {
  const IS_LINUX = process.platform === "linux";
  const VERCEL_RAW = String(process.env.VERCEL || "").toLowerCase();
  const IS_VERCEL = VERCEL_RAW === "1" || VERCEL_RAW === "true";
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
        margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
      });
      await page.close();
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  // Local dev: prefer system Chrome via puppeteer-core
  const puppeteer = (await import("puppeteer-core")).default as any;

  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const winChrome1 = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const winChrome2 = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";

  let sysExec = "";
  try {
    if (process.platform === "darwin" && fs.existsSync(macChrome)) sysExec = macChrome;
    if (process.platform === "win32" && fs.existsSync(winChrome1)) sysExec = winChrome1;
    if (process.platform === "win32" && fs.existsSync(winChrome2)) sysExec = winChrome2;
  } catch {}

  if (sysExec) {
    dbg(`using system chrome: ${sysExec}`);
    const browser = await puppeteer.launch({ executablePath: sysExec, headless: true, args: [] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
      });
      await page.close();
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  // Final fallback: Playwright
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
      margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
    });
    await page.close();
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

async function renderPdfToFile(html: string, outPath: string): Promise<string> {
  const buf = await htmlToPdfBuffer(html);
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.writeFile(outPath, buf);
  return outPath;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setCors(res);
  dbg(`${req.method} ${req.url}`);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    // Simple ping
    return res.status(200).json({ ok: true, route: "/api/render-all" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET,POST,OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = (req.body ?? {}) as any;
    const raw = (body.data ?? body) as Partial<InvoiceData>; // accept {data: {...}} or plain invoice JSON
    let data = normalizeInvoice(raw);

    // Determine languages
    const all: boolean = Boolean(body.all ?? false);
    let langs: Lang[] = [];
    if (Array.isArray(body.languages) && body.languages.length) {
      langs = body.languages.map((l: string) => resolveLang(l));
    } else if (all) {
      langs = [...SUPPORTED_LANGS];
    } else {
      const single = resolveLang((body.language ?? data.language) as string);
      langs = [single];
    }
    langs = uniq(langs.filter((l) => SUPPORTED_LANGS.includes(l)));
    if (langs.length === 0) langs = ["de"];

    // Ensure invoice number
    if (!data.number || String(data.number).trim() === "") {
      const { number } = await nextNumber({ scope: "month", pad: 4 });
      data = { ...data, number };
    }

    const requestedZipRaw = String(body.zipName ?? (raw as any)?.zipName ?? "").trim();
    const requestedBase = requestedZipRaw ? sanitizeZipBaseName(requestedZipRaw) : "";
    const zipName = requestedBase ? `${requestedBase}.zip` : `rechnung-${data.number}-bundle.zip`;

    const download = String((req.query as any)?.download ?? "") === "1" || String(body.download ?? "") === "1";

    // Download mode: stream ZIP directly (no /out files)
    if (download) {
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${zipName}"; filename*=UTF-8''${encodeURIComponent(zipName)}`
      );
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", (err: any) => {
        try {
          res.destroy(err);
        } catch {}
      });
      archive.pipe(res);

      (async () => {
        for (const lang of langs) {
          const html = await renderInvoiceHtml(data, { inlineStyles: true, language: lang });
          const pdfBuf = await htmlToPdfBuffer(html);
          const name = `rechnung-${data.number}-${lang}.pdf`;
          archive.append(pdfBuf, { name });
        }
        await archive.finalize();
      })().catch((e) => {
        try {
          res.destroy(e);
        } catch {}
      });

      return;
    }

    // Non-download mode: write PDFs + ZIP to disk and return JSON (useful in local dev)
    const outDir = pickOutDir();
    await fsp.mkdir(outDir, { recursive: true });

    const pdfs: { lang: Lang; name: string; path: string }[] = [];
    for (const lang of langs) {
      const html = await renderInvoiceHtml(data, { inlineStyles: true, language: lang });
      const name = `rechnung-${data.number}-${lang}.pdf`;
      const fp = path.join(outDir, name);
      const abs = await renderPdfToFile(html, fp);
      pdfs.push({ lang, name, path: abs });
    }

    const zipPath = path.join(outDir, zipName);

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });
      output.on("close", () => resolve());
      archive.on("error", (err: any) => reject(err));
      archive.pipe(output);
      for (const p of pdfs) archive.file(p.path, { name: p.name });
      archive.finalize();
    });

    return res.status(200).json({ ok: true, zip: zipPath, files: pdfs, number: data.number, languages: langs });
  } catch (e: any) {
    console.error("[render-all] error", e);
    return res.status(400).json({ error: e?.message ?? "Render-all error" });
  }
}
