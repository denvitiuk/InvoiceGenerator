import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import Handlebars from "handlebars";
import { format } from "date-fns";
import type { Locale } from "date-fns";
import { de, enUS, ru, bg, tr, uk } from "date-fns/locale";

import { preloadInvoiceDicts, registerTHelper, resolveLang, type Lang } from "./i18n";
import { ExtraImage, InvoiceData, InvoiceTheme, LineItem } from "@/types/invoice";


const hbs = Handlebars.create();

const LOCALES: Record<Lang, Locale> = {
  de,
  en: enUS,
  ru,
  bg,
  tr,
  uk,
} as const;

const ROOT = process.cwd();
const TPL_DIR = path.resolve(ROOT, "templates");
const PARTIALS_DIR = path.join(TPL_DIR, "partials");
const BASE_TPL = path.join(TPL_DIR, "base.hbs");
const STYLES_CSS = path.join(TPL_DIR, "styles.css");

const r2 = (n: number) => Math.round(n * 100) / 100;

function defaultTheme(): InvoiceTheme {
  return {
    colors: {
      primary: "#111827",
      secondary: "#6b7280",
      accent: "#0ea5e9",
      text: "#111827",
      mutedText: "#6b7280",
      background: "#ffffff",
      surface: "#f7f7f8",
      border: "#e5e7eb",
      gradientFrom: "#111827",
      gradientTo: "#0ea5e9",
    },
    layout: { roundness: 16, logoAlign: "left", logoHeight: 56 },
  };
}

function clampRoundness(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return 16;
  return Math.max(0, Math.min(24, Math.floor(n)));
}

function themeToCssVars(theme?: InvoiceTheme): string {
  const t = theme ?? defaultTheme();
  const c = t.colors as any;
  const r = clampRoundness(t.layout?.roundness);

  // Logo layout controls (optional)
  const layout: any = t.layout as any;
  const logoHeightRaw = layout?.logoHeight;
  const logoHeightNum = typeof logoHeightRaw === "number" ? logoHeightRaw : parseInt(String(logoHeightRaw ?? ""), 10);
  // Cap logo height in the PDF to avoid layout breakage (user UI may allow bigger).
  const logoH = Number.isFinite(logoHeightNum) ? Math.max(16, Math.min(120, Math.floor(logoHeightNum))) : 56;

  const logoAlign = String(layout?.logoAlign ?? "left").toLowerCase();
  const logoJustify = logoAlign === "center" ? "center" : logoAlign === "right" ? "flex-end" : "flex-start";

  // Reserve a top band for centered logo so it doesn't overlap the header title/content.
  // Keep a hard upper bound so users can't "eat" the whole first page.
  const logoReserve = logoAlign === "center"
    ? Math.max(0, Math.min(140, logoH + 16))
    : 0;

  // Title ("Rechnung") scales with the same slider as the logo.
  // Default logo (56px) => ~24px title, bigger logo => bigger title (capped).
  const h1Size = Math.max(20, Math.min(34, Math.round(12 + logoH * 0.22)));

  const primary = c.primary || "#111827";
  const accent = c.accent || "#0ea5e9";

  const vars: string[] = [
    `--c-primary:${primary}`,
    `--c-secondary:${c.secondary || "#6b7280"}`,
    `--c-accent:${accent}`,
    `--c-text:${c.text || "#111827"}`,
    `--c-muted:${c.mutedText || "#6b7280"}`,
    `--c-bg:${c.background || "#ffffff"}`,
    `--c-surface:${c.surface || "#f7f7f8"}`,
    `--c-border:${c.border || "#e5e7eb"}`,
    `--g-from:${(c.gradientFrom && String(c.gradientFrom).trim()) ? c.gradientFrom : primary}`,
    `--g-to:${(c.gradientTo && String(c.gradientTo).trim()) ? c.gradientTo : accent}`,
    `--round:${r}px`,
    `--logo-justify:${logoJustify}`,
    `--logo-h:${logoH}px`,
    `--logo-reserve:${logoReserve}px`,
    `--h1-size:${h1Size}px`,
  ];

  return vars.join(";");
}

function fmtMoney(n: number, currency: string, lang: Lang) {
  const locale =
    lang === "de" ? "de-DE" :
    lang === "ru" ? "ru-RU" :
    lang === "bg" ? "bg-BG" :
    lang === "tr" ? "tr-TR" :
    lang === "uk" ? "uk-UA" :
    "en-US";
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(n);
}

function toDisplayDate(iso: string, lang: Lang) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return format(d, "dd.MM.yyyy", { locale: LOCALES[lang] });
}

function fileUrl(p?: string, baseUrl?: string) {
  if (!p) return undefined;
  const s = String(p).trim();
  if (!s) return undefined;

  // Already a web URL or data-uri (Chromium can fetch it)
  if (/^(https?:|data:|file:)/i.test(s)) return s;

  // If it looks like a site-relative path, keep it for browser preview,
  // or make it absolute for headless PDF when baseUrl is provided.
  if (s.startsWith("/")) return baseUrl ? `${baseUrl}${s}` : s;

  // Otherwise treat as a filesystem path
  const abs = path.resolve(s);
  return pathToFileURL(abs).toString();
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
  /** Base URL (e.g. https://host) used to turn relative /api/... paths into absolute URLs for headless PDF. */
  baseUrl?: string;
}

export function calcModel(data: InvoiceData, lang: Lang, baseUrl?: string) {
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

  const dueRaw = (data as any).dueDays;
  const dueNum = typeof dueRaw === "number" ? dueRaw : parseInt(String(dueRaw), 10);
  const hasDue = Number.isFinite(dueNum) && dueNum > 0;

  const paymentTerms = !hasDue
    ? "" // optional: hide entirely
    : (lang === "de" ? `Zahlbar innerhalb von ${dueNum} Tagen`
      : lang === "ru" ? `Оплатить в течение ${dueNum} дней`
      : lang === "bg" ? `Платимо в рамките на ${dueNum} дни`
      : lang === "tr" ? `${dueNum} gün içinde ödenir`
      : lang === "uk" ? `До сплати протягом ${dueNum} днів`
      : `Payable within ${dueNum} days`);

  const notes = [...(data.notes ?? [])];
  if (data.kleinunternehmer) notes.push("Gemäß §19 UStG wird keine Umsatzsteuer berechnet.");
  if (data.reverseCharge) notes.push("Steuerschuldnerschaft des Leistungsempfängers (Reverse-Charge).");

  const extraImages = (data.extraImages ?? []).map((img: ExtraImage) => ({
    src: fileUrl(img.path, baseUrl),
    caption: img.caption,
    maxWidthPx: img.maxWidthPx ?? 480,
  }));

  return {
    language: lang,
    themeStyle: themeToCssVars((data as any).theme),
    number: data.number,
    company: { ...data.company, logoPath: fileUrl(data.company.logoPath, baseUrl), logoUrl: fileUrl((data.company as any).logoUrl, baseUrl) },
    client: data.client,
    issueDate,
    servicePeriod: data.servicePeriod
      ? {
          from: toDisplayDate(data.servicePeriod.fromISO, lang),
          to: toDisplayDate(data.servicePeriod.toISO, lang),
        }
      : null,
    paymentTerms,
    showPaymentBox: Boolean(paymentTerms) || Boolean(data.company?.iban) || Boolean(data.company?.bic) || Boolean(data.company?.bankName),
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
  const model = calcModel(data, lang, opts.baseUrl) as any;
  model.styles = styles; // base.hbs checks {{#if styles}} …

  return tpl(model);
}
export const renderHTML = renderInvoiceHtml;
