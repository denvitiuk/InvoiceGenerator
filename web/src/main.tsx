import React from "react";
import ReactDOM from "react-dom/client";
import "./app.css";
import AppShell from "./components/AppShell";
import { I18nProvider } from "./lib/i18n";

const SUPPORTED = ["en", "de", "ru", "bg", "tr"] as const;
type Lang = typeof SUPPORTED[number];
const UI_LANG_KEY = "ui.lang";

function detectLang(): Lang {
  const saved = (localStorage.getItem(UI_LANG_KEY) as Lang | null);
  if (saved && (SUPPORTED as readonly string[]).includes(saved)) return saved;

  const navList = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language || "en"];
  const lower = navList.filter(Boolean).map(l => l.toLowerCase());
  const guess = (SUPPORTED as readonly string[]).find(l => lower.some(n => n?.startsWith(l))) || "en";
  localStorage.setItem(UI_LANG_KEY, guess);
  return guess as Lang;
}

let rootEl = document.getElementById("root");
if (!rootEl) {
  rootEl = document.createElement("div");
  rootEl.id = "root";
  document.body.appendChild(rootEl);
}

ReactDOM.createRoot(rootEl!).render(
  // StrictMode выключен, чтобы эффекты не вызывались дважды в dev и не провоцировали циклы
  <I18nProvider defaultLang={detectLang()}>
    <AppShell />
  </I18nProvider>
);
