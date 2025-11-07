// web/src/ClientApp.tsx
'use client';
import React, { useMemo } from 'react';
import AppShell from './components/AppShell';
import { I18nProvider } from './lib/i18n';

const SUPPORTED = ['en','de','ru','bg','tr','uk'] as const;
type Lang = typeof SUPPORTED[number];
const UI_LANG_KEY = 'ui.lang';

function detectLang(): Lang {
    if (typeof window === 'undefined') return 'en' as Lang; // SSR-фолбек
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

export default function ClientApp() {
    const lang = useMemo(detectLang, []);
    return (
        <I18nProvider defaultLang={lang}>
            <AppShell />
        </I18nProvider>
    );
}