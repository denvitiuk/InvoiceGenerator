import * as fs from "node:fs/promises";
import * as path from "node:path";
import Handlebars from "handlebars";
import { format } from "date-fns";
import type { Locale } from "date-fns";
import { de, enUS, ru, bg, tr } from "date-fns/locale";

import { preloadInvoiceDicts, registerTHelper, resolveLang, type Lang } from "./i18n.js";
import type { ExtraImage, InvoiceData, LineItem } from "../types/invoice.js";

const hbs = Handlebars.create();

const LOCALES: Record<Lang, Locale> = {
  de,
  en: enUS,
  ru,
  bg,
  tr,
} as const;

const ROOT = process.cwd();
const TPL_DIR = path.resolve(ROOT, "templates");
const PARTIALS_DIR = path.join(TPL_DIR, "partials");
const BASE_TPL = path.join(TPL_DIR, "base.hbs");
const STYLES_CSS = path.join(TPL_DIR, "styles.css");

const r2 = (n: number) => Math.round(n * 100) / 100;

function fmtMoney(n: number, currency: string, lang: Lang) {
  const locale =
    lang === "de" ? "de-DE" :
    lang === "ru" ? "ru-RU" :
    lang === "bg" ? "bg-BG" :
    lang === "tr" ? "tr-TR" :
    "en-US";
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(n);
}

function toDisplayDate(iso: string, lang: Lang) {
  const d = new Date(iso);
  return format(d, "dd.MM.yyyy", { locale: LOCALES[lang] });
}

function fileUrl(p?: string) {
  if (!p) return undefined;
  const abs = path.resolve(p);
  return new URL(`file://${abs}`).toString();
}

async function loadStylesInline(): Promise<string> {
  try {
    return await fs.readFile(STYLES_CSS, "utf-8");
  } catch {
    return "";
  }
}

async function registerPartials() {
  try {
    const files = await fs.readdir(PARTIALS_DIR);
    for (const f of files) {
      if (!f.endsWith(".hbs")) continue;
      const name = path.basename(f, ".hbs");
      const html = await fs.readFile(path.join(PARTIALS_DIR, f), "utf-8");
      hbs.registerPartial(name, html);
    }
  } catch {
    // no partials directory – skip
  }
}

export interface BuildHtmlOptions {
  /** Override language for the invoice (otherwise uses data.language, default DE). */
  language?: Lang;
  /** Inline styles into <style>…</style> (recommended for PDF). */
  inlineStyles?: boolean;
}

export function calcModel(data: InvoiceData, lang: Lang) {
  const rows = (data.items || []).map((it: LineItem) => {
    const net = r2((it.qty || 0) * (it.unitPrice || 0));
    return {
      description: it.description,
      qty: it.qty,
      unit: it.unit ?? "",
      unitPrice: fmtMoney(it.unitPrice, data.currency, lang),
      vatRate: it.vatRate ? `${it.vatRate}%` : "0%",
      total: fmtMoney(net, data.currency, lang),
      _net: net,
      _r: it.vatRate || 0,
    };
  });

  const subtotalNet = r2(rows.reduce((s: number, r: any) => s + (r._net || 0), 0));
  const vatMap = new Map<number, number>();
  for (const r of rows as any[]) {
    const vat = r2((r._net || 0) * ((r._r || 0) / 100));
    vatMap.set(r._r, r2((vatMap.get(r._r) ?? 0) + vat));
  }
  const vatBlocks = data.kleinunternehmer
    ? []
    : Array.from(vatMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([rate, amount]) => ({ rate: `${rate}%`, amount: fmtMoney(amount, data.currency, lang), _amount: amount }));
  const vatTotal = r2(vatBlocks.reduce((s: number, b: any) => s + b._amount, 0));
  const grand = data.kleinunternehmer ? subtotalNet : r2(subtotalNet + vatTotal);

  const issueDate = toDisplayDate(data.issueDateISO, lang);
  const paymentTerms = data.dueDays && data.dueDays > 0
    ? (lang === "de" ? `Zahlbar innerhalb von ${data.dueDays} Tagen`
      : lang === "ru" ? `Оплатить в течение ${data.dueDays} дней`
      : lang === "bg" ? `Платимо в рамките на ${data.dueDays} дни`
      : lang === "tr" ? `${data.dueDays} gün içinde ödenir`
      : `Payable within ${data.dueDays} days`)
    : (lang === "de" ? "Zahlbar sofort ohne Abzug"
      : lang === "ru" ? "К оплате немедленно"
      : lang === "bg" ? "Платимо веднага"
      : lang === "tr" ? "Fatura alındığında ödenir"
      : "Due upon receipt");

  const notes = [...(data.notes ?? [])];
  if (data.kleinunternehmer) notes.push("Gemäß §19 UStG wird keine Umsatzsteuer berechnet.");
  if (data.reverseCharge) notes.push("Steuerschuldnerschaft des Leistungsempfängers (Reverse-Charge).");

  const extraImages = (data.extraImages ?? []).map((img: ExtraImage) => ({
    src: fileUrl(img.path),
    caption: img.caption,
    maxWidthPx: img.maxWidthPx ?? 480,
  }));

  return {
    language: lang,
    number: data.number,
    company: { ...data.company, logoPath: fileUrl(data.company.logoPath) },
    client: data.client,
    issueDate,
    servicePeriod: data.servicePeriod
      ? {
          from: toDisplayDate(data.servicePeriod.fromISO, lang),
          to: toDisplayDate(data.servicePeriod.toISO, lang),
        }
      : null,
    paymentTerms,
    itemRows: rows,
    subtotal: fmtMoney(subtotalNet, data.currency, lang),
    vatBlocks: data.kleinunternehmer ? [] : vatBlocks,
    grandTotal: fmtMoney(grand, data.currency, lang),
    notes,
    extraTables: data.extraTables ?? [],
    extraImages,
  };
}

export async function renderInvoiceHtml(data: InvoiceData, opts: BuildHtmlOptions = {}): Promise<string> {
  const lang = resolveLang(opts.language ?? data.language);

  // i18n helper
  const dicts = await preloadInvoiceDicts();
  registerTHelper(hbs as any, dicts);

  // partials
  await registerPartials();

  // template
  const tplSrc = await fs.readFile(BASE_TPL, "utf-8");
  const tpl = hbs.compile(tplSrc, { noEscape: true });

  // styles inline or external link
  const styles = opts.inlineStyles ? await loadStylesInline() : "";

  // data model
  const model = calcModel(data, lang) as any;
  model.styles = styles; // base.hbs checks {{#if styles}} …

  return tpl(model);
}
export const renderHTML = renderInvoiceHtml;
