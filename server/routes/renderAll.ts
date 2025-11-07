import type { Express, Request, Response } from "express";
import * as path from "node:path";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
// @ts-ignore - no official types for archiver v7, treat as any
import archiver from "archiver";

const OUT_DIR = path.resolve(process.cwd(), "out");
const TMP_OUT_DIR = path.resolve(process.env.TMPDIR || "/tmp", "out");

const s = (v: any) => (typeof v === "string" ? v.trim() : v == null ? undefined : String(v).trim());
const strArr = (v: any): string[] => Array.isArray(v) ? v.map((x) => s(x) || "").filter(Boolean) : [];
const cleanIban = (v: any) => (s(v)?.replace(/\s+/g, "") || undefined);
const cleanBic = (v: any) => (s(v)?.replace(/\s+/g, "").toUpperCase() || undefined);

import { renderInvoiceHtml } from "../lib/template.js";
import { renderPdf, renderPdfBuffer } from "../lib/pdf.js";
import { nextNumber } from "../lib/seq.js";
import { SUPPORTED_LANGS, resolveLang, type Lang } from "../lib/i18n.js";
import type { InvoiceData } from "../types/invoice.js";

function normalizeInvoice(data: Partial<InvoiceData> | undefined): InvoiceData {
  const d = (data || {}) as Partial<InvoiceData>;
  const todayIso = new Date().toISOString().slice(0, 10);

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


function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export default function registerRenderAll(app: Express) {
  // Render PDFs for multiple languages and return a ZIP bundle
  app.post("/render-all", async (req: Request, res: Response) => {
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

      // If ?download=1, stream ZIP directly (no /out files)
      if (String(req.query.download ?? "0") === "1") {
        const requestedZipRaw = String(body.zipName ?? (raw as any)?.zipName ?? "").trim();
        const sanitizeBaseName = (s: string) => s
          .replace(/\.zip$/i, "")
          .replace(/[\\\/:*?"<>|]+/g, "")
          .replace(/\s+/g, " ")
          .trim();
        const requestedBase = requestedZipRaw ? sanitizeBaseName(requestedZipRaw) : "";
        const zipName = requestedBase ? `${requestedBase}.zip` : `rechnung-${data.number}-bundle.zip`;

        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

        const archive = archiver("zip", { zlib: { level: 9 } });
        archive.on("error", (err: any) => { try { res.destroy(err); } catch {} });
        archive.pipe(res);

        (async () => {
          // Generate all PDFs in-memory, then append to archive
          for (const lang of langs) {
            const html = await renderInvoiceHtml(data, { inlineStyles: true, language: lang });
            const pdfBuf = await renderPdfBuffer({ html });
            const name = `rechnung-${data.number}-${lang}.pdf`;
            archive.append(pdfBuf, { name });
          }
          await archive.finalize();
        })().catch((e) => {
          try { res.destroy(e); } catch {}
        });

        return; // response will finish when archive stream ends
      }

      const outDir = process.env.VERCEL ? TMP_OUT_DIR : OUT_DIR;
      await fsp.mkdir(outDir, { recursive: true });

      // Render PDFs per language
      const pdfs: { lang: Lang; name: string; path: string }[] = [];
      for (const lang of langs) {
        const html = await renderInvoiceHtml(data, { inlineStyles: true, language: lang });
        const name = `rechnung-${data.number}-${lang}.pdf`;
        const fp = path.join(outDir, name);
        const abs = await renderPdf({ html, outPath: fp });
        pdfs.push({ lang, name, path: abs });
      }

      // Create ZIP (support optional custom zipName, sanitize, and add .zip)
      const requestedZipRaw = String(body.zipName ?? (raw as any)?.zipName ?? "").trim();
      const sanitizeBaseName = (s: string) => s
        .replace(/\.zip$/i, "")              // drop .zip if provided
        .replace(/[\\\/:*?"<>|]+/g, "")   // forbidden FS chars
        .replace(/\s+/g, " ")               // collapse spaces
        .trim();
      const requestedBase = requestedZipRaw ? sanitizeBaseName(requestedZipRaw) : "";
      const defaultZipName = `rechnung-${data.number}-bundle.zip`;
      const zipName = requestedBase ? `${requestedBase}.zip` : defaultZipName;
      const zipPath = path.join(outDir, zipName);

      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver("zip", { zlib: { level: 9 } });
        output.on("close", () => resolve());
        archive.on("error", (err: any) => reject(err));
        archive.pipe(output);
        for (const p of pdfs) {
          archive.file(p.path, { name: p.name });
        }
        archive.finalize();
      });

      // Respond
      if (String(req.query.download ?? "0") === "1") {
        res.download(zipPath, zipName);
      } else {
        res.json({ ok: true, zip: zipPath, files: pdfs, number: data.number, languages: langs });
      }
    } catch (e: any) {
      res.status(400).json({ error: e?.message ?? "Render-all error" });
    }
  });

  app.get('/render-all', (_req: Request, res: Response) => {
    res.type('html').send('<!doctype html><meta charset="utf-8"><body>OK /render-all</body>');
  });
  app.get('/render-all/health', (_req: Request, res: Response) => res.json({ ok: true }));
}
