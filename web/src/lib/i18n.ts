import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type UILang = "en" | "de" | "ru" | "bg" | "tr";
const SUPPORTED: UILang[] = ["en", "de", "ru", "bg", "tr"];

function clampLang(v?: string): UILang {
  const x = (v || "en").toLowerCase();
  return (SUPPORTED as string[]).includes(x) ? (x as UILang) : "en";
}

export type Dict = Record<string, string>;

async function fetchUIStrings(lang: UILang): Promise<Dict> {
  // Server serves /i18n as static; fallback to EN on error
  try {
    const res = await fetch(`/i18n/ui/${lang}.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as Dict;
    return json;
  } catch (e) {
    if (lang !== "en") return fetchUIStrings("en");
    return {};
  }
}

function interpolate(str: string, vars?: Record<string, string | number>): string {
  if (!vars) return str;
  return Object.keys(vars).reduce((acc, k) => acc.replaceAll(`{{${k}}}`, String(vars[k])), str);
}

interface I18nContextValue {
  lang: UILang;
  setLang: (l: UILang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  dict: Dict;
  ready: boolean;
}

const I18nContext = createContext<I18nContextValue>({
  lang: "en",
  setLang: () => {},
  t: (k: string) => k,
  dict: {},
  ready: false,
});

export function I18nProvider({ defaultLang = "en", children }: { defaultLang?: UILang; children: React.ReactNode }) {
  const [lang, setLang] = useState<UILang>(clampLang(defaultLang));
  const [dict, setDict] = useState<Dict>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    setReady(false);
    fetchUIStrings(lang).then((d) => {
      if (!alive) return;
      setDict(d);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [lang]);

  const t = useMemo(() => {
    return (key: string, vars?: Record<string, string | number>) => {
      const str = dict[key] ?? key;
      return interpolate(str, vars);
    };
  }, [dict]);

  const value = useMemo<I18nContextValue>(() => ({ lang, setLang, t, dict, ready }), [lang, t, dict, ready]);

  return React.createElement(I18nContext.Provider, { value }, children);
}

export function useI18n() {
  return useContext(I18nContext);
}

export function useT() {
  return useI18n().t;
}
