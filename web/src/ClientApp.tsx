// web/src/ClientApp.tsx
'use client';
import React, { useMemo, useState } from 'react';
import AppShell from './components/AppShell';
import { I18nProvider } from './lib/i18n';
import { readInvoiceSessionToken } from './connected/session/fragmentToken';
import { ConnectedSessionProvider } from './connected/session/ConnectedSessionContext';
import { hasStoredSession } from './connected/session/editorToken';

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
    // Read (and immediately strip) the one-shot connected-invoice token exactly
    // once, before the first paint that could otherwise leave it visible in the
    // URL bar. Never persisted, never logged. If there's no fresh token but a
    // connected editor session survived from before a reload (sessionStorage),
    // mount the connected provider anyway with a null token — it restores from
    // that stored session instead of exchanging again. This also covers an
    // *expired* stored session: mounting the provider is what lets it show a
    // "session expired" screen instead of silently falling through to a blank
    // standalone editor.
    const [connected] = useState<{ shouldMount: boolean; token: string | null }>(() => {
        if (typeof window === 'undefined') return { shouldMount: false, token: null };
        const token = readInvoiceSessionToken();
        return { shouldMount: Boolean(token) || hasStoredSession(), token };
    });

    return (
        <I18nProvider defaultLang={lang}>
            {connected.shouldMount ? (
                <ConnectedSessionProvider token={connected.token}>
                    <AppShell />
                </ConnectedSessionProvider>
            ) : (
                <AppShell />
            )}
        </I18nProvider>
    );
}