import type { Express, Request, Response } from "express";
import * as path from "node:path";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
// @ts-ignore - no official types for archiver v7, treat as any
import archiver from "archiver";

import { renderInvoiceHtml } from "../lib/template.js";
import { renderPdf } from "../lib/pdf.js";
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

      const outDir = path.join(process.cwd(), "out");
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

      // Create ZIP
      const zipName: string = body.zipName || `rechnung-${data.number}-bundle.zip`;
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
}
