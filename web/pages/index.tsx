import Head from 'next/head';
import React from 'react';
import AppShell from '../src/components/AppShell';
import { I18nProvider } from '../src/lib/i18n';

const SUPPORTED = ['en','de','ru','bg','tr','uk'] as const;
type Lang = typeof SUPPORTED[number];
const UI_LANG_KEY = 'ui.lang';

function safeDetectLang(): Lang {
  if (typeof window === 'undefined') return 'en' as Lang; // SSR fallback
  try {
    const saved = window.localStorage.getItem(UI_LANG_KEY) as Lang | null;
    if (saved && (SUPPORTED as readonly string[]).includes(saved)) return saved;

    const navList = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language || 'en'];
    const lower = navList.filter(Boolean).map(l => l.toLowerCase());
    const guess = (SUPPORTED as readonly string[]).find(l => lower.some(n => n?.startsWith(l))) || 'en';
    window.localStorage.setItem(UI_LANG_KEY, guess);
    return guess as Lang;
  } catch {
    return 'en' as Lang;
  }
}

export default function Home() {
  const [lang, setLang] = React.useState<Lang>('en');

  React.useEffect(() => {
    setLang(safeDetectLang());
  }, []);

  return (
    <>
      <Head>
        <title>InvoiceGenerator</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <I18nProvider defaultLang={lang}>
        <AppShell />
      </I18nProvider>
      <noscript>
        You need to enable JavaScript to run this app.
      </noscript>
    </>
  );
}
