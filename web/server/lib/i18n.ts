import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as fssync from "node:fs";
import type Handlebars from "handlebars";

export type Lang = "de" | "en" | "ru" | "bg" | "tr" | "uk" ;
export const SUPPORTED_LANGS: Lang[] = ["de", "en", "ru", "bg", "tr","uk"];
export type Dict = Record<string, string>;

const ROOT = process.cwd();

function pickI18nBaseDir() {
  // In Next dev/serverless, `process.cwd()` is usually `.../invoicegener/web`.
  // But some environments may run from the repo root. Support both.
  const candidates = [
    path.resolve(ROOT, "public", "i18n"),
    path.resolve(ROOT, "web", "public", "i18n"),
    // Backward-compat (old Express layout)
    path.resolve(ROOT, "i18n"),
  ];

  for (const c of candidates) {
    try {
      if (fssync.existsSync(c)) return c;
    } catch {
      // ignore
    }
  }

  // Default to the Next layout.
  return path.resolve(ROOT, "public", "i18n");
}

const I18N_BASE = pickI18nBaseDir();

const DIRS = {
  invoice: path.resolve(I18N_BASE, "invoice"),
  ui: path.resolve(I18N_BASE, "ui"),
};

const cache = {
  invoice: new Map<Lang, Dict>(),
  ui: new Map<Lang, Dict>(),
};

const ALIASES: Record<string, Lang> = { ua: "uk" };

export function resolveLang(input?: string): Lang {
  const raw = (input || "").toLowerCase().trim();
  if (!raw) return "de";
  // accept BCP-47 style tags like "de-DE", "ru_RU" → take base part
  const base = (raw.split(/[-_]/, 1)[0] || raw);
  const norm = (ALIASES[base] || base) as Lang | string;
  return (SUPPORTED_LANGS as readonly string[]).includes(norm as string) ? (norm as Lang) : "de";
}

async function readJsonSafe<T = unknown>(fp: string): Promise<T | {}> {
  try {
    const raw = await fs.readFile(fp, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return {};
  }
}

async function load(kind: "invoice" | "ui", lang: Lang): Promise<Dict> {
  const m = cache[kind];
  const cached = m.get(lang);
  if (cached) return cached;

  const dir = DIRS[kind];
  const file = path.join(dir, `${lang}.json`);
  const obj = await readJsonSafe<Record<string, unknown>>(file);
  const dict: Dict = Object.entries(obj).reduce<Dict>((acc, [k, v]) => {
    if (typeof k === "string" && typeof v === "string") acc[k] = v;
    return acc;
  }, {} as Dict);
  m.set(lang, dict);
  return dict;
}

/** Invoice template strings with fallback to DE */
export async function getInvoiceStrings(langInput?: string): Promise<Dict> {
  const lang = resolveLang(langInput);
  const base = await load("invoice", "de");
  const loc = lang === "de" ? base : await load("invoice", lang);
  return { ...base, ...loc };
}

/** UI strings for the web app with fallback to DE */
export async function getUIStrings(langInput?: string): Promise<Dict> {
  const lang = resolveLang(langInput);
  const base = await load("ui", "de");
  const loc = lang === "de" ? base : await load("ui", lang);
  return { ...base, ...loc };
}

/** Preload all invoice dictionaries (useful to keep Handlebars helper synchronous). */
export async function preloadInvoiceDicts(langs: Lang[] = SUPPORTED_LANGS): Promise<Record<Lang, Dict>> {
  const entries: [Lang, Dict][] = [];
  for (const l of langs) entries.push([l, await getInvoiceStrings(l)]);
  return Object.fromEntries(entries) as Record<Lang, Dict>;
}

/** Register synchronous Handlebars helper `{{t key}}` that reads from preloaded dicts. */
export function registerTHelper(hbs: typeof Handlebars, dicts: Record<Lang, Dict>) {
  hbs.registerHelper("t", function (this: any, key: string, options?: Handlebars.HelperOptions) {
    const ctxLang = (this?.language as Lang | undefined);
    const rootLang = (options?.data?.root?.language as Lang | undefined);
    const lang = resolveLang(ctxLang ?? rootLang ?? "de");
    const d = dicts[lang] || dicts.de || {};
    return d[key] ?? key;
  });
}