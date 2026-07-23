import React, { useRef, useState } from "react";
import { useStore, calcTotals } from "../lib/store";
import { useI18n, useT } from "../lib/i18n";
import { previewInvoice, renderInvoiceBlob, renderInvoiceDocxBlob, renderAllBlob, openInNewTab, uploadFile } from "../lib/api";

import PreviewPane from "./PreviewPane";
import {Lang} from "../../server/lib/i18n";
import {
  InvoiceData,
  LineItem,
  MonthlyCalculation,
  MonthlyDailyEntry,
  MonthlyCalculationMode,
  NumberingMode,
} from "@/types/invoice";






const LANGS: Lang[] = ["en", "de", "ru", "bg", "tr","uk"];
const CURRENCIES = ["EUR", "USD", "GBP", "UAH"] as const;

const dbg = (...a: any[]) => console.log("[AppShell]", ...a);

type InvoiceTemplate = {
  id: string;
  name: string;
  updatedAt: string;
  invoiceLang: Lang;
  // Older templates do not have this flag and continue to apply only the header/design data.
  includeItems?: boolean;
  data: Partial<InvoiceData>;
};

const TEMPLATES_LS_KEY = "invoice:templates";

const TEMPLATES_DEFAULT_ID_KEY = "invoice:templates:defaultId";
const INVOICE_STORE_LS_KEY = "invoice.store"; // zustand persist key (see web/src/lib/store.ts)

function readDefaultTemplateId(): string {
  try {
    return localStorage.getItem(TEMPLATES_DEFAULT_ID_KEY) || "";
  } catch {
    return "";
  }
}

function writeDefaultTemplateId(id: string) {
  try {
    if (!id) localStorage.removeItem(TEMPLATES_DEFAULT_ID_KEY);
    else localStorage.setItem(TEMPLATES_DEFAULT_ID_KEY, id);
  } catch {
    // ignore
  }
}

function safeUuid(): string {
  // crypto.randomUUID is available in modern browsers; fall back to a simple id.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `tpl_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function readTemplates(): InvoiceTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as InvoiceTemplate[]) : [];
  } catch {
    return [];
  }
}

function writeTemplates(next: InvoiceTemplate[]) {
  localStorage.setItem(TEMPLATES_LS_KEY, JSON.stringify(next));
}

function pickTemplateData(inv: InvoiceData, includeItems: boolean): Partial<InvoiceData> {
  const data: Partial<InvoiceData> = {
    company: inv.company,
    client: inv.client,
    currency: inv.currency,
    dueDays: (inv as any).dueDays,
    object: (inv as any).object,
    theme: (inv as any).theme,
    documentTitle: (inv as any).documentTitle,
    showNumberInTitle: (inv as any).showNumberInTitle,
    numberingMode: (inv as any).numberingMode,
    fileName: (inv as any).fileName,
  };

  if (includeItems) {
    data.items = inv.items.map((item) => ({ ...item }));
  }

  return data;
}

function templateDataToApply(tpl: InvoiceTemplate): Partial<InvoiceData> {
  const data = { ...tpl.data };

  // The explicit flag preserves the meaning of an empty saved list: applying such
  // a template should clear the current positions. Array.isArray keeps compatibility
  // with any templates that already contain items but predate the flag.
  if (tpl.includeItems || Array.isArray(tpl.data.items)) {
    data.items = (tpl.data.items || []).map((item) => ({ ...item }));
  } else {
    delete data.items;
  }

  return data;
}

function escapeDescriptionText(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function legacyDescriptionToRichHtml(value: unknown): string {
  return escapeDescriptionText(value)
    .replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\r\n?|\n/g, "<br />");
}

function sanitizeStoredDescriptionHtml(value: unknown): string {
  return escapeDescriptionText(value)
    .replace(/&lt;(?:strong|b)&gt;/gi, "<strong>")
    .replace(/&lt;\/(?:strong|b)&gt;/gi, "</strong>")
    .replace(/&lt;br\s*\/?&gt;/gi, "<br />");
}

function serializeDescriptionEditor(editor: HTMLDivElement): string {
  function serialize(node: ChildNode): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeDescriptionText(node.textContent || "");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();
    const children = Array.from(element.childNodes).map(serialize).join("");

    if (tag === "strong" || tag === "b") return `<strong>${children}</strong>`;
    if (tag === "br") return "<br />";
    if (tag === "div" || tag === "p") return `${children}<br />`;
    return children;
  }

  return Array.from(editor.childNodes)
    .map(serialize)
    .join("")
    .replace(/(?:<br \/>)+$/g, "");
}

type RichDescriptionEditorProps = {
  id: string;
  item: LineItem;
  placeholder: string;
  boldLabel: string;
  boldHint: string;
  calendarLabel: string;
  calendarHint: string;
  onOpenMonthCalculator: () => void;
  onChange: (patch: Pick<LineItem, "description" | "descriptionHtml">) => void;
};

function RichDescriptionEditor({
  id,
  item,
  placeholder,
  boldLabel,
  boldHint,
  calendarLabel,
  calendarHint,
  onOpenMonthCalculator,
  onChange,
}: RichDescriptionEditorProps) {
  const editorRef = React.useRef<HTMLDivElement | null>(null);
  const storedHtml = React.useMemo(
    () =>
      typeof item.descriptionHtml === "string"
        ? sanitizeStoredDescriptionHtml(item.descriptionHtml)
        : legacyDescriptionToRichHtml(item.description),
    [item.description, item.descriptionHtml]
  );

  React.useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    if (editor.innerHTML !== storedHtml) editor.innerHTML = storedHtml;
  }, [storedHtml]);

  function commit(normalizeDom = false) {
    const editor = editorRef.current;
    if (!editor) return;

    const descriptionHtml = serializeDescriptionEditor(editor);
    const description = (editor.innerText || "")
      .replaceAll("\u00a0", " ")
      .replace(/\n+$/g, "");

    if (normalizeDom && editor.innerHTML !== descriptionHtml) {
      editor.innerHTML = descriptionHtml;
    }

    onChange({ description, descriptionHtml });
  }

  function toggleBold() {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand("bold", false);
    commit();
  }

  return (
    <div className="invoice-item-description-control">
      <div
        id={id}
        ref={editorRef}
        className="rich-description-editor"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        data-placeholder={placeholder}
        onInput={() => commit()}
        onBlur={() => commit(true)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
            event.preventDefault();
            toggleBold();
          }
        }}
        onPaste={(event) => {
          event.preventDefault();
          document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
          commit();
        }}
      />
      <button
        type="button"
        className="invoice-item-bold"
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggleBold}
        title={boldHint}
        aria-label={boldLabel}
      >
        B
      </button>
      <button
        type="button"
        className={`invoice-item-calendar${item.monthlyCalculation ? " is-active" : ""}`}
        onClick={onOpenMonthCalculator}
        title={calendarHint}
        aria-label={calendarLabel}
      >
        📅
      </button>
    </div>
  );
}

const LOCALE_BY_LANG: Record<Lang, string> = {
  en: "en-US",
  de: "de-DE",
  ru: "ru-RU",
  bg: "bg-BG",
  tr: "tr-TR",
  uk: "uk-UA",
};

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function datesInMonth(month: string): string[] {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) return [];

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from(
    { length: count },
    (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`
  );
}

function isWeekday(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

function weekdaysInMonth(month: string): string[] {
  return datesInMonth(month).filter(isWeekday);
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

type MonthlyCalculationDialogProps = {
  value?: MonthlyCalculation;
  defaultMonth: string;
  lang: Lang;
  currency: string;
  unitPrice: number;
  t: Translate;
  onApply: (calculation: MonthlyCalculation) => void;
  onClear: () => void;
  onClose: () => void;
};

function MonthlyCalculationDialog({
  value,
  defaultMonth,
  lang,
  currency,
  unitPrice,
  t,
  onApply,
  onClear,
  onClose,
}: MonthlyCalculationDialogProps) {
  const initialMonth = value?.month || defaultMonth || currentMonthValue();
  const [month, setMonth] = React.useState(initialMonth);
  const [mode, setMode] = React.useState<MonthlyCalculationMode>(value?.mode || "weekdays");
  const [manualDates, setManualDates] = React.useState<string[]>(
    value?.mode === "selected" ? [...value.selectedDates].sort() : []
  );
  const firstDailyEntry = value?.dailyEntries?.[0];
  const [detailed, setDetailed] = React.useState(Boolean(value?.detailed));
  const [defaultPeople, setDefaultPeople] = React.useState(firstDailyEntry?.people ?? 1);
  const [defaultHours, setDefaultHours] = React.useState(firstDailyEntry?.hours ?? 8);
  const [dailyOverrides, setDailyOverrides] = React.useState<Record<string, MonthlyDailyEntry>>(
    () =>
      Object.fromEntries(
        (value?.dailyEntries || []).map((entry) => [entry.date, { ...entry }])
      )
  );

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const allDates = React.useMemo(() => datesInMonth(month), [month]);
  const selectedDates = React.useMemo(
    () =>
      mode === "weekdays"
        ? weekdaysInMonth(month)
        : manualDates.filter((date) => date.startsWith(`${month}-`)).sort(),
    [manualDates, mode, month]
  );
  const selectedSet = React.useMemo(() => new Set(selectedDates), [selectedDates]);
  const dailyEntries = React.useMemo(
    () =>
      selectedDates.map((date) => {
        const override = dailyOverrides[date];
        return {
          date,
          people: override?.people ?? defaultPeople,
          hours: override?.hours ?? defaultHours,
        };
      }),
    [dailyOverrides, defaultHours, defaultPeople, selectedDates]
  );
  const totalHours = dailyEntries.reduce(
    (sum, entry) => sum + entry.people * entry.hours,
    0
  );
  const estimatedTotal = totalHours * (Number.isFinite(unitPrice) ? unitPrice : 0);
  const leadingBlanks = allDates.length
    ? (new Date(`${allDates[0]}T00:00:00Z`).getUTCDay() + 6) % 7
    : 0;
  const weekdayLabels = React.useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) =>
        new Intl.DateTimeFormat(LOCALE_BY_LANG[lang], {
          weekday: "short",
          timeZone: "UTC",
        }).format(new Date(Date.UTC(2026, 0, 5 + index)))
      ),
    [lang]
  );
  const monthLabel = /^\d{4}-\d{2}$/.test(month)
    ? new Intl.DateTimeFormat(LOCALE_BY_LANG[lang], {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${month}-01T00:00:00Z`))
    : month;

  function selectMode(nextMode: MonthlyCalculationMode) {
    setMode(nextMode);
    if (nextMode === "selected" && mode !== "selected" && !manualDates.length) {
      setManualDates([]);
    }
  }

  function toggleDate(date: string) {
    if (mode !== "selected") return;
    setManualDates((current) =>
      current.includes(date)
        ? current.filter((item) => item !== date)
        : [...current, date].sort()
    );
  }

  function updateDailyEntry(date: string, patch: Partial<MonthlyDailyEntry>) {
    setDailyOverrides((current) => {
      const existing = current[date] || {
        date,
        people: defaultPeople,
        hours: defaultHours,
      };
      return {
        ...current,
        [date]: {
          ...existing,
          ...patch,
          date,
        },
      };
    });
  }

  function updatePeopleForAll(people: number) {
    setDefaultPeople(people);
    setDailyOverrides((current) =>
      Object.fromEntries(
        selectedDates.map((date) => [
          date,
          {
            date,
            people,
            hours: current[date]?.hours ?? defaultHours,
          },
        ])
      )
    );
  }

  function updateHoursForAll(hours: number) {
    setDefaultHours(hours);
    setDailyOverrides((current) =>
      Object.fromEntries(
        selectedDates.map((date) => [
          date,
          {
            date,
            people: current[date]?.people ?? defaultPeople,
            hours,
          },
        ])
      )
    );
  }

  function formatDay(date: string): string {
    return new Intl.DateTimeFormat(LOCALE_BY_LANG[lang], {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      timeZone: "UTC",
    }).format(new Date(`${date}T00:00:00Z`));
  }

  function formatMoney(value: number): string {
    try {
      return new Intl.NumberFormat(LOCALE_BY_LANG[lang], {
        style: "currency",
        currency,
      }).format(value);
    } catch {
      return `${value.toFixed(2)} ${currency}`;
    }
  }

  return (
    <div
      className="month-calc-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`month-calc-dialog${detailed ? " is-detailed" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={t("month_calc_title") || "Monthly calculation"}
      >
        <div className="month-calc-header">
          <div>
            <h2>{t("month_calc_title") || "Monthly calculation"}</h2>
            <p>{t("month_calc_hint") || "Choose all weekdays or individual dates."}</p>
          </div>
          <button type="button" className="month-calc-close" onClick={onClose} aria-label={t("month_calc_cancel") || "Cancel"}>
            ×
          </button>
        </div>

        <label className="month-calc-month">
          <span>{t("month_calc_month") || "Month"}</span>
          <input
            type="month"
            value={month}
            onChange={(event) => {
              const nextMonth = event.target.value;
              if (!nextMonth) return;
              setMonth(nextMonth);
              setManualDates((dates) => dates.filter((date) => date.startsWith(`${nextMonth}-`)));
            }}
          />
        </label>

        <div className="month-calc-modes">
          <button
            type="button"
            className={mode === "weekdays" ? "is-active" : ""}
            onClick={() => selectMode("weekdays")}
          >
            <strong>{t("month_calc_weekdays") || "All weekdays"}</strong>
            <span>{t("month_calc_weekdays_note") || "Monday–Friday"}</span>
          </button>
          <button
            type="button"
            className={mode === "selected" ? "is-active" : ""}
            onClick={() => selectMode("selected")}
          >
            <strong>{t("month_calc_selected") || "Selected days"}</strong>
            <span>{t("month_calc_selected_note") || "Choose dates in the calendar"}</span>
          </button>
        </div>

        <div className="month-calc-calendar" aria-label={monthLabel}>
          {weekdayLabels.map((label, index) => (
            <div key={`${label}-${index}`} className="month-calc-weekday">{label}</div>
          ))}
          {Array.from({ length: leadingBlanks }, (_, index) => (
            <span key={`blank-${index}`} className="month-calc-blank" />
          ))}
          {allDates.map((date) => {
            const selected = selectedSet.has(date);
            const weekend = !isWeekday(date);
            return (
              <button
                key={date}
                type="button"
                className={[
                  "month-calc-day",
                  selected ? "is-selected" : "",
                  weekend ? "is-weekend" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => toggleDate(date)}
                aria-pressed={selected}
                disabled={mode === "weekdays"}
              >
                {Number(date.slice(8, 10))}
              </button>
            );
          })}
        </div>

        <label className="month-calc-detail-toggle">
          <input
            type="checkbox"
            checked={detailed}
            onChange={(event) => setDetailed(event.target.checked)}
          />
          <span>
            <strong>{t("month_calc_detailed") || "Detailed daily breakdown"}</strong>
            <small>
              {t("month_calc_detailed_hint") ||
                "Show a separate invoice row for every selected date"}
            </small>
          </span>
        </label>

        {detailed && (
          <div className="month-calc-details">
            <div className="month-calc-defaults">
              <label>
                <span>{t("month_calc_default_people") || "People for all days"}</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={defaultPeople}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    updatePeopleForAll(
                      Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
                    );
                  }}
                />
              </label>
              <label>
                <span>{t("month_calc_default_hours") || "Hours per person"}</span>
                <input
                  type="number"
                  min={0}
                  step={0.25}
                  value={defaultHours}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    updateHoursForAll(Number.isFinite(value) ? Math.max(0, value) : 0);
                  }}
                />
              </label>
            </div>

            <div className="month-calc-daily-header">
              <strong>{t("month_calc_daily_breakdown") || "Days and hours"}</strong>
              <span>
                {t("month_calc_hourly_rate", { rate: formatMoney(unitPrice) }) ||
                  `Rate: ${formatMoney(unitPrice)}`}
              </span>
            </div>

            <div className="month-calc-daily-list">
              {dailyEntries.map((entry) => {
                const rowHours = entry.people * entry.hours;
                return (
                  <div className="month-calc-daily-row" key={entry.date}>
                    <div className="month-calc-daily-date">{formatDay(entry.date)}</div>
                    <label>
                      <span>{t("month_calc_people") || "People"}</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={entry.people}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          updateDailyEntry(entry.date, {
                            people: Number.isFinite(value)
                              ? Math.max(1, Math.floor(value))
                              : 1,
                          });
                        }}
                      />
                    </label>
                    <label>
                      <span>{t("month_calc_hours") || "Hours"}</span>
                      <input
                        type="number"
                        min={0}
                        step={0.25}
                        value={entry.hours}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          updateDailyEntry(entry.date, {
                            hours: Number.isFinite(value) ? Math.max(0, value) : 0,
                          });
                        }}
                      />
                    </label>
                    <strong className="month-calc-daily-total">
                      {new Intl.NumberFormat(LOCALE_BY_LANG[lang], {
                        maximumFractionDigits: 2,
                      }).format(rowHours)}{" "}
                      h
                    </strong>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="month-calc-summary">
          <div>
            <strong>
              {detailed
                ? t("month_calc_total_hours", {
                    hours: new Intl.NumberFormat(LOCALE_BY_LANG[lang], {
                      maximumFractionDigits: 2,
                    }).format(totalHours),
                  }) || `Total person-hours: ${totalHours}`
                : t("month_calc_selected_count", { count: selectedDates.length }) ||
                  `${selectedDates.length} days selected`}
            </strong>
            <span>{monthLabel}</span>
          </div>
          {detailed && (
            <strong className="month-calc-estimated-total">
              {formatMoney(estimatedTotal)}
            </strong>
          )}
        </div>

        <div className="month-calc-actions">
          {value && (
            <button type="button" className="month-calc-remove" onClick={onClear}>
              {t("month_calc_remove") || "Remove calculation"}
            </button>
          )}
          <button type="button" onClick={onClose}>
            {t("month_calc_cancel") || "Cancel"}
          </button>
          <button
            type="button"
            data-variant="primary"
            disabled={!selectedDates.length}
            onClick={() =>
              onApply({
                month,
                mode,
                selectedDates,
                detailed,
                dailyEntries: detailed
                  ? dailyEntries.map((entry) => ({ ...entry }))
                  : undefined,
              })
            }
          >
            {t("month_calc_apply") || "Apply calculation"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AppShell() {
  const t = useT();
  const { lang: uiLang, setLang: setUILangCtx } = useI18n();

  // Store selectors
  const invoice = useStore((s) => s.invoice as InvoiceData);
  const invoiceLang = useStore((s) => s.invoiceLang as Lang);
  const setInvoiceLang = useStore((s) => s.setInvoiceLang);
  const setCurrency = useStore((s) => s.setCurrency);
  const setDueDays = useStore((s) => s.setDueDays);
  const patchCompany = useStore((s) => s.patchCompany);
  const patchClient = useStore((s) => s.patchClient);
  const patchInvoice = React.useCallback(
    (patch: Partial<InvoiceData>) => {
      useStore.setState((s: any) => ({ invoice: { ...s.invoice, ...patch } }));
    },
    []
  );
  const addItem = useStore((s) => s.addItem);
  const updateItem = useStore((s) => s.updateItem);
  const removeItem = useStore((s) => s.removeItem);
  const [monthlyCalculationItemIndex, setMonthlyCalculationItemIndex] = React.useState<number | null>(null);

  // Theme / palette actions (Receipt Pro)
  const applyThemePreset = useStore((s: any) => s.applyThemePreset);
  const clearTheme = useStore((s: any) => s.clearTheme);
  const patchThemeColors = useStore((s: any) => s.patchThemeColors);
  const setThemeRoundness = useStore((s: any) => s.setThemeRoundness);

  // Helper to patch theme.layout (logo alignment, size, etc)
  const patchThemeLayout = React.useCallback(
    (layoutPatch: any) => {
      const curTheme: any = (invoice as any)?.theme || {};
      const curLayout: any = curTheme.layout || {};
      patchInvoice({ theme: { ...curTheme, layout: { ...curLayout, ...layoutPatch } } } as any);
    },
    [invoice, patchInvoice]
  );


  const [showPalette, setShowPalette] = useState(false);

  // Templates (localStorage) ---------------------------------------------
  const [templates, setTemplates] = React.useState<InvoiceTemplate[]>(() => {
    if (typeof window === "undefined") return [];
    return readTemplates();
  });
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string>("");
  const [includeItemsInTemplate, setIncludeItemsInTemplate] = React.useState(true);
  const [defaultTemplateId, setDefaultTemplateId] = React.useState<string>(() => {
    if (typeof window === "undefined") return "";
    return readDefaultTemplateId();
  });

  function refreshTemplates() {
    const next = readTemplates();
    setTemplates(next);

    // keep selection if it still exists
    if (selectedTemplateId && !next.some((t) => t.id === selectedTemplateId)) {
      setSelectedTemplateId("");
    }

    // keep default if it still exists
    if (defaultTemplateId && !next.some((t) => t.id === defaultTemplateId)) {
      writeDefaultTemplateId("");
      setDefaultTemplateId("");
    }
  }

  function onSaveTemplateAs() {
    const name = (prompt(t("template_name_prompt") || "Template name", "") || "").trim();
    if (!name) return;
    const tpl: InvoiceTemplate = {
      id: safeUuid(),
      name,
      updatedAt: new Date().toISOString(),
      invoiceLang,
      includeItems: includeItemsInTemplate,
      data: pickTemplateData(invoice, includeItemsInTemplate),
    };
    const next = [tpl, ...templates].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    writeTemplates(next);
    setTemplates(next);
    setSelectedTemplateId(tpl.id);
  }

  function onApplyTemplate() {
    const id = selectedTemplateId;
    if (!id) return;
    const tpl = templates.find((x) => x.id === id);
    if (!tpl) return;

    patchInvoice(templateDataToApply(tpl));
    setInvoiceLang(tpl.invoiceLang);

    // Ensure dueDays draft reflects applied template.
    const v = (tpl.data as any)?.dueDays;
    setDueDaysDraft(v === undefined || v === null || v === "" ? "" : String(v));

    alert((t("template_applied") || "Template applied") + `: ${tpl.name}`);
  }

  function onDeleteTemplate() {
    const id = selectedTemplateId;
    if (!id) return;
    const tpl = templates.find((x) => x.id === id);
    if (!tpl) return;
    const ok = confirm((t("template_delete_confirm") || "Delete template?") + `\n\n${tpl.name}`);
    if (!ok) return;
    const next = templates.filter((x) => x.id !== id);
    writeTemplates(next);
    setTemplates(next);
    setSelectedTemplateId("");
  }

  function onRenameTemplate() {
    const id = selectedTemplateId;
    if (!id) return;
    const tpl = templates.find((x) => x.id === id);
    if (!tpl) return;
    const nextName = (prompt(t("template_rename_prompt") || "Rename template", tpl.name) || "").trim();
    if (!nextName) return;

    const next = templates.map((x) => (x.id === id ? { ...x, name: nextName, updatedAt: new Date().toISOString() } : x));
    writeTemplates(next);
    setTemplates(next);
  }

  function onUpdateTemplate() {
    const id = selectedTemplateId;
    if (!id) return;
    const tpl = templates.find((x) => x.id === id);
    if (!tpl) return;

    const ok = confirm((t("template_update_confirm") || "Update selected template with current settings?") + `\n\n${tpl.name}`);
    if (!ok) return;

    const updated: InvoiceTemplate = {
      ...tpl,
      updatedAt: new Date().toISOString(),
      invoiceLang,
      includeItems: includeItemsInTemplate,
      data: pickTemplateData(invoice, includeItemsInTemplate),
    };

    const next = [updated, ...templates.filter((x) => x.id !== id)].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    writeTemplates(next);
    setTemplates(next);
    setSelectedTemplateId(updated.id);
  }

  function onToggleDefaultTemplate() {
    const id = selectedTemplateId;
    if (!id) return;
    const next = defaultTemplateId === id ? "" : id;
    writeDefaultTemplateId(next);
    setDefaultTemplateId(next);
  }

  // Keep templates list fresh if user opens the app in multiple tabs.
  React.useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === TEMPLATES_LS_KEY) refreshTemplates();
      if (e.key === TEMPLATES_DEFAULT_ID_KEY) {
        setDefaultTemplateId(readDefaultTemplateId());
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplateId, templates]);

  // Auto-apply default template ONLY when there is no persisted draft.
  const didAutoApplyDefaultRef = React.useRef(false);
  React.useEffect(() => {
    if (didAutoApplyDefaultRef.current) return;
    if (typeof window === "undefined") return;

    // If there is a persisted invoice draft, never auto-apply.
    const hasPersistedDraft = !!window.localStorage.getItem(INVOICE_STORE_LS_KEY);
    if (hasPersistedDraft) {
      didAutoApplyDefaultRef.current = true;
      return;
    }

    // Only apply if invoice still looks empty (avoid overwriting user edits from a just-loaded JSON restore).
    const looksEmpty =
      (!invoice?.items || invoice.items.length === 0) &&
      (!invoice?.number || String(invoice.number).trim() === "") &&
      (!invoice?.company?.name || String(invoice.company.name).trim() === "") &&
      (!invoice?.client?.name || String(invoice.client.name).trim() === "");

    if (!looksEmpty) {
      didAutoApplyDefaultRef.current = true;
      return;
    }

    const id = defaultTemplateId;
    if (!id) {
      didAutoApplyDefaultRef.current = true;
      return;
    }

    const tpl = templates.find((x) => x.id === id);
    if (!tpl) {
      didAutoApplyDefaultRef.current = true;
      return;
    }

    patchInvoice(templateDataToApply(tpl));
    setInvoiceLang(tpl.invoiceLang);

    // Ensure dueDays draft reflects applied template.
    const v = (tpl.data as any)?.dueDays;
    setDueDaysDraft(v === undefined || v === null || v === "" ? "" : String(v));

    didAutoApplyDefaultRef.current = true;
  }, [defaultTemplateId, templates, invoice]);

  // Logo upload
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoFileRef = useRef<HTMLInputElement | null>(null);

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploadingLogo(true);
    try {
      const resp = await uploadFile(f);
      patchCompany({ logoPath: resp.path });
    } catch (err: any) {
      alert(err?.message || "Upload failed");
    } finally {
      setUploadingLogo(false);
      e.target.value = "";
    }
  }

  const totals = React.useMemo(() => calcTotals(invoice), [invoice]);

  // Zahlungsziel (due days) ------------------------------------------------
  // Make it optional in the UI. We will later align server/template behavior
  // so empty really means "do not show".
  const [dueDaysDraft, setDueDaysDraft] = React.useState<string>(() => {
    const v = (invoice as any)?.dueDays;
    return v === undefined || v === null || v === "" ? "" : String(v);
  });

  function commitDueDays(v: string) {
    const vv = (v || "").trim();
    // Empty means: user wants to remove Zahlungsziel
    if (!vv) {
      patchInvoice({ dueDays: undefined } as any);
      return;
    }
    const n = parseInt(vv, 10);
    if (!Number.isFinite(n) || n < 0) return;
    // We patch directly to avoid store forcing a default while the user is typing
    patchInvoice({ dueDays: n } as any);
  }

  // Keep draft in sync when invoice changes externally (load preset / reset)
  React.useEffect(() => {
    const v = (invoice as any)?.dueDays;
    setDueDaysDraft(v === undefined || v === null || v === "" ? "" : String(v));
  }, [(invoice as any)?.dueDays]);

  // Dates helpers ---------------------------------------------------------
  function normalizeISODate(raw: string): string {
    const v = (raw || "").trim();
    if (!v) return "";

    // ISO date: 2025-10-07
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;

    // Common EU formats: 07.10.2025 or 07/10/2025
    const m = v.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
    if (m) {
      const dd = m[1];
      const mm = m[2];
      const yyyy = m[3];
      return `${yyyy}-${mm}-${dd}`;
    }

    return "";
  }

  function isoToDate(iso: string): Date | null {
    const v = normalizeISODate(iso);
    if (!v) return null;
    const [y, m, d] = v.split("-").map((x) => parseInt(x, 10));
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function dateToISO(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function lastDayOfMonth(year: number, month1to12: number): number {
    return new Date(year, month1to12, 0).getDate();
  }

  type PeriodMode = "none" | "custom" | "month" | "week" | "year";

  function inferPeriodMode(sp?: { fromISO?: string; toISO?: string }): PeriodMode {
    const from = isoToDate(sp?.fromISO || "");
    const to = isoToDate(sp?.toISO || "");
    if (!from && !to) return "none";
    if (!from || !to) return "custom";

    // year: Jan 1 .. Dec 31
    if (
      from.getMonth() === 0 &&
      from.getDate() === 1 &&
      to.getMonth() === 11 &&
      to.getDate() === 31 &&
      from.getFullYear() === to.getFullYear()
    ) {
      return "year";
    }

    // month: 1st .. last day of same month
    const sameMonth = from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth();
    if (sameMonth && from.getDate() === 1) {
      const ld = lastDayOfMonth(from.getFullYear(), from.getMonth() + 1);
      if (to.getDate() === ld) return "month";
    }

    // week: Monday..Sunday (difference 6 days)
    const diffDays = Math.round((to.getTime() - from.getTime()) / 86400000);
    const mondayIndex = (from.getDay() + 6) % 7; // Monday=0
    const sundayIndex = (to.getDay() + 6) % 7; // Sunday=6
    if (diffDays === 6 && mondayIndex === 0 && sundayIndex === 6) return "week";

    return "custom";
  }

  function monthToRange(yyyyMm: string): { fromISO: string; toISO: string } | null {
    const v = (yyyyMm || "").trim();
    if (!/^\d{4}-\d{2}$/.test(v)) return null;
    const [yS, mS] = v.split("-");
    const y = parseInt(yS, 10);
    const m = parseInt(mS, 10);
    if (!y || !m) return null;
    const from = new Date(y, m - 1, 1);
    const to = new Date(y, m - 1, lastDayOfMonth(y, m));
    return { fromISO: dateToISO(from), toISO: dateToISO(to) };
  }

  function yearToRange(year: string): { fromISO: string; toISO: string } | null {
    const y = parseInt((year || "").trim(), 10);
    if (!y || y < 1900 || y > 3000) return null;
    return { fromISO: `${y}-01-01`, toISO: `${y}-12-31` };
  }

  function weekToRange(anchorIso: string): { fromISO: string; toISO: string } | null {
    const d = isoToDate(anchorIso);
    if (!d) return null;
    const dayIndex = (d.getDay() + 6) % 7; // Monday=0
    const from = new Date(d);
    from.setDate(d.getDate() - dayIndex);
    const to = new Date(from);
    to.setDate(from.getDate() + 6);
    return { fromISO: dateToISO(from), toISO: dateToISO(to) };
  }

  function setServicePeriod(patch: { fromISO?: string; toISO?: string }) {
    const current = (invoice as any)?.servicePeriod || {};
    const merged = { ...current, ...patch };
    if (!merged.fromISO && !merged.toISO) {
      patchInvoice({ servicePeriod: undefined } as any);
    } else {
      patchInvoice({ servicePeriod: merged } as any);
    }
  }

  const [periodMode, setPeriodMode] = React.useState<PeriodMode>(() => inferPeriodMode((invoice as any)?.servicePeriod));
  const [periodMonth, setPeriodMonth] = React.useState<string>(() => {
    const sp = (invoice as any)?.servicePeriod;
    const from = normalizeISODate(sp?.fromISO || "");
    if (from) return from.slice(0, 7); // YYYY-MM
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  // Draft to avoid re-render/patch while the user is still typing year/month in the picker
  const [periodMonthDraft, setPeriodMonthDraft] = React.useState<string>(periodMonth);

  function commitMonth(v: string) {
    const vv = (v || "").trim();
    if (!/^\d{4}-\d{2}$/.test(vv)) return;
    setPeriodMonth(vv);
    const r = monthToRange(vv);
    if (r) patchInvoice({ servicePeriod: r } as any);
  }

  // Keep draft in sync when value is changed externally (e.g., loading invoice/preset)
  React.useEffect(() => {
    setPeriodMonthDraft(periodMonth);
  }, [periodMonth]);
  const [periodWeekAnchor, setPeriodWeekAnchor] = React.useState<string>(() => {
    const sp = (invoice as any)?.servicePeriod;
    const from = normalizeISODate(sp?.fromISO || "");
    if (from) return from;
    return dateToISO(new Date());
  });
  const [periodYear, setPeriodYear] = React.useState<string>(() => {
    const sp = (invoice as any)?.servicePeriod;
    const from = normalizeISODate(sp?.fromISO || "");
    if (from) return from.slice(0, 4);
    return String(new Date().getFullYear());
  });

  function clearServicePeriod() {
    patchInvoice({ servicePeriod: undefined } as any);
  }

  function applyPeriodMode(next: PeriodMode) {
    setPeriodMode(next);

    if (next === "none") {
      clearServicePeriod();
      return;
    }

    if (next === "custom") {
      // Keep existing range, but if there is none, initialize to today..today
      const cur = (invoice as any)?.servicePeriod;
      const hasAny = Boolean(cur?.fromISO || cur?.toISO);
      if (!hasAny) {
        const today = dateToISO(new Date());
        patchInvoice({ servicePeriod: { fromISO: today, toISO: today } } as any);
      }
      return;
    }

    if (next === "month") {
      // use draft to avoid forcing a value mid-edit
      const candidate = periodMonthDraft || periodMonth;
      const r = monthToRange(candidate);
      if (r) {
        patchInvoice({ servicePeriod: r } as any);
      } else {
        // fall back to current month
        const now = new Date();
        const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        setPeriodMonthDraft(fallback);
        setPeriodMonth(fallback);
        const rr = monthToRange(fallback);
        if (rr) patchInvoice({ servicePeriod: rr } as any);
      }
      return;
    }

    if (next === "week") {
      const r = weekToRange(periodWeekAnchor);
      if (r) patchInvoice({ servicePeriod: r } as any);
      return;
    }

    if (next === "year") {
      const r = yearToRange(periodYear);
      if (r) patchInvoice({ servicePeriod: r } as any);
      return;
    }
  }

  // Keep mode in sync if invoice is loaded/changed externally
  React.useEffect(() => {
    setPeriodMode(inferPeriodMode((invoice as any)?.servicePeriod));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    (invoice as any)?.servicePeriod?.fromISO,
    (invoice as any)?.servicePeriod?.toISO,
  ]);

  // Auto-migrate non-ISO dates (e.g. DD.MM.YYYY) into ISO so <input type="date"> works
  React.useEffect(() => {
    const rawIssue = ((invoice as any)?.issueDateISO || "").trim();
    const normalizedIssue = normalizeISODate(rawIssue);
    if (rawIssue && normalizedIssue && rawIssue !== normalizedIssue) {
      patchInvoice({ issueDateISO: normalizedIssue } as any);
    }

    const rawFrom = (((invoice as any)?.servicePeriod?.fromISO) || "").trim();
    const normalizedFrom = normalizeISODate(rawFrom);
    if (rawFrom && normalizedFrom && rawFrom !== normalizedFrom) {
      setServicePeriod({ fromISO: normalizedFrom });
    }

    const rawTo = (((invoice as any)?.servicePeriod?.toISO) || "").trim();
    const normalizedTo = normalizeISODate(rawTo);
    if (rawTo && normalizedTo && rawTo !== normalizedTo) {
      setServicePeriod({ toISO: normalizedTo });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helpers ---------------------------------------------------------------
  function downloadBlob(name: string, blob: Blob) {
    dbg("downloadBlob", { name, size: blob.size, type: blob.type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function downloadFromOut(filePath: string, name?: string) {
    dbg("downloadFromOut", { path: filePath, name });
    const url = `/api/download?path=${encodeURIComponent(filePath)}${name ? `&name=${encodeURIComponent(name)}` : ""}`;
    const a = document.createElement("a");
    a.href = url;
    if (name) a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Actions --------------------------------------------------------------
  async function onRenderPDF() {
    try {
      dbg("onRenderPDF:start", { invoiceLang, fileName: (invoice as any).fileName });
      const { blob, filename } = await renderInvoiceBlob(invoice, invoiceLang);
      dbg("onRenderPDF:gotBlob", { filename, size: blob.size, type: blob.type });
      downloadBlob(filename, blob);
      alert(`${t("success_render")}: ${filename}`);
    } catch (e: any) {
      dbg("onRenderPDF:error", e);
      alert(e?.message || "Render failed");
    }
  }

  async function onRenderDOCX() {
    try {
      dbg("onRenderDOCX:start", { invoiceLang, fileName: (invoice as any).fileName });
      const { blob, filename } = await renderInvoiceDocxBlob(invoice, invoiceLang);
      dbg("onRenderDOCX:gotBlob", { filename, size: blob.size, type: blob.type });
      downloadBlob(filename, blob);
      alert(`${t("success_render")}: ${filename}`);
    } catch (e: any) {
      dbg("onRenderDOCX:error", e);
      alert(e?.message || "Render failed");
    }
  }

  async function onRenderAll() {
    try {
      dbg("onRenderAll:start", { all: true, fileName: (invoice as any).fileName });
      const { blob, filename } = await renderAllBlob(invoice, { all: true });
      dbg("onRenderAll:gotBlob", { filename, size: blob.size, type: blob.type });
      downloadBlob(filename, blob);
      alert(`${t("success_render_all")}: ${filename}`);
    } catch (e: any) {
      dbg("onRenderAll:error", e);
      alert(e?.message || "ZIP failed");
    }
  }

  async function onOpenPreview() {
    try {
      dbg("onOpenPreview:start", { invoiceLang });
      const h = await previewInvoice(invoice, invoiceLang);
      dbg("onOpenPreview:htmlLength", h?.length);
      openInNewTab(h);
    } catch (e: any) {
      alert(e?.message || "Preview failed");
    }
  }

  function onDownloadLastData() {
    dbg("onDownloadLastData");
    const pretty = JSON.stringify(invoice, null, 2);
    const blob = new Blob([pretty], { type: "application/json" });
    const name = `invoice-last-${new Date().toISOString().slice(0,10)}.json`;
    dbg("onDownloadLastData:download", { name });
    downloadBlob(name, blob);
  }

  const monthlyCalculationItem =
    monthlyCalculationItemIndex === null
      ? undefined
      : invoice.items[monthlyCalculationItemIndex];

  // Layout ---------------------------------------------------------------
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 560px) 1fr", height: "100vh" }}>
      {/* Left column: form */}
      <div style={{ padding: 16, overflow: "auto", borderRight: "1px solid #eee" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18 }}>{t("app_title")}</h1>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              value={uiLang}
              onChange={(e) => { const v = e.target.value as Lang; dbg("setUILang", v); setUILangCtx(v); }}
              title={t("language_ui")}
            >
              {LANGS.map((l) => (<option key={l} value={l}>{l.toUpperCase()}</option>))}
            </select>
            <select
              value={invoiceLang}
              onChange={(e) => { const v = e.target.value as Lang; dbg("setInvoiceLang", v); setInvoiceLang(v); }}
              title={t("language_invoice")}
            >
              {LANGS.map((l) => (<option key={l} value={l}>{l.toUpperCase()}</option>))}
            </select>
          </div>
        </header>

        {/* Company */}
        <section style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>{t("section_company")}</h3>
          <input
            placeholder={t("company_name") || "Company name"}
            value={invoice.company.name}
            onChange={(e) => patchCompany({ name: e.target.value })}
            style={{ width: "100%", marginBottom: 8 }}
          />

          {/* Logo */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <input
              ref={logoFileRef}
              type="file"
              accept="image/*,.svg"
              style={{ display: "none" }}
              onChange={onPickLogo}
            />
            <button
              type="button"
              onClick={() => logoFileRef.current?.click()}
              disabled={uploadingLogo}
              style={{ padding: "10px 14px", borderRadius: 14 }}
            >
              {uploadingLogo ? "…" : (t("add_logo") || "Add logo")}
            </button>
            <button
              type="button"
              onClick={() => patchCompany({ logoPath: undefined as any, logoUrl: undefined as any })}
              disabled={!(invoice.company as any)?.logoPath && !(invoice.company as any)?.logoUrl}
              style={{ padding: "10px 14px", borderRadius: 14, opacity: 0.85 }}
              title={t("remove_logo") || "Remove logo"}
            >
              {t("remove_logo") || "Remove logo"}
            </button>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {(invoice.company as any)?.logoPath ? (t("logo.selected") || "Logo selected") : (t("logo_hint") || "PNG/JPG/SVG")}
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontSize: 12, opacity: 0.85, display: "flex", alignItems: "center", gap: 6 }}>
                {t("logo.section") || "Logo"}
                <select
                  value={((invoice as any)?.theme?.layout?.logoAlign || "left") as any}
                  onChange={(e) => patchThemeLayout({ logoAlign: e.target.value })}
                  style={{ padding: "8px 10px", borderRadius: 12 }}
                  title={t("logo.align") || "Logo alignment"}
                >
                  <option value="left">{t("logo.align_left") || "Left"}</option>
                  <option value="center">{t("logo.align_center") || "Center"}</option>
                  <option value="right">{t("logo.align_right") || "Right"}</option>
                </select>
              </label>

              <label style={{ fontSize: 12, opacity: 0.85, display: "flex", alignItems: "center", gap: 6 }}>
                {t("logo.size") || "Size"}
                <input
                  type="range"
                  min={24}
                  max={140}
                  value={((invoice as any)?.theme?.layout?.logoHeight ?? 56) as any}
                  onChange={(e) => patchThemeLayout({ logoHeight: parseInt(e.target.value, 10) })}
                />
                <span style={{ fontSize: 12, opacity: 0.85, minWidth: 44, textAlign: "right" }}>
                  {((invoice as any)?.theme?.layout?.logoHeight ?? 56)}px
                </span>
              </label>

              <button
                type="button"
                onClick={() => patchThemeLayout({ logoAlign: "left", logoHeight: 56 })}
                style={{ padding: "10px 12px", borderRadius: 14, opacity: 0.85 }}
                title={t("logo.reset") || "Reset"}
              >
                {t("logo.reset") || "Reset"}
              </button>
            </div>
          </div>
          <textarea
            placeholder={t("address")}
            value={(invoice.company.addressLines || []).join("\n")}
            onChange={(e) => patchCompany({ addressLines: e.target.value.split(/\r?\n/) })}
            rows={3}
            style={{ width: "100%", marginBottom: 8 }}
          />

          {/* Contacts */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input
              placeholder={t("email") || "Email"}
              value={invoice.company.email || ""}
              onChange={(e) => patchCompany({ email: e.target.value })}
            />
            <input
              placeholder={t("phone") || "Phone"}
              value={invoice.company.phone || ""}
              onChange={(e) => patchCompany({ phone: e.target.value })}
            />
            <input
              placeholder={t("website") || "Website"}
              value={invoice.company.website || ""}
              onChange={(e) => patchCompany({ website: e.target.value })}
            />
          </div>

          {/* Bank details */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <input
              placeholder={t("iban") || "IBAN"}
              value={invoice.company.iban || ""}
              onChange={(e) => patchCompany({ iban: e.target.value.replace(/\s+/g, "") })}
            />
            <input
              placeholder={t("bic") || "BIC"}
              value={invoice.company.bic || ""}
              onChange={(e) => patchCompany({ bic: e.target.value.toUpperCase().replace(/\s+/g, "") })}
            />
            <input
              placeholder={t("bank_name") || "Bank name"}
              value={invoice.company.bankName || ""}
              onChange={(e) => patchCompany({ bankName: e.target.value })}
              style={{ gridColumn: "1 / span 2" }}
            />
          </div>
          {/* Tax identifiers */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <input
              placeholder={t("ustId") || "USt-IdNr."}
              value={invoice.company.ustId || ""}
              onChange={(e) => patchCompany({ ustId: e.target.value })}
            />
            <input
              placeholder={t("steuerNr") || "Steuernummer"}
              value={invoice.company.steuerNr || ""}
              onChange={(e) => patchCompany({ steuerNr: e.target.value })}
            />
          </div>
        </section>

        {/* Client */}
        <section style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>{t("section_client")}</h3>
          <input
            placeholder={t("client_name") || "Client name"}
            value={invoice.client.name}
            onChange={(e) => patchClient({ name: e.target.value })}
            style={{ width: "100%", marginBottom: 8 }}
          />
          <textarea
            placeholder={t("address")}
            value={(invoice.client.addressLines || []).join("\n")}
            onChange={(e) => patchClient({ addressLines: e.target.value.split(/\r?\n/) })}
            rows={3}
            style={{ width: "100%" }}
          />
        </section>

        {/* Meta */}
        <section style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("currency")}</label>
            <select value={invoice.currency} onChange={(e) => setCurrency(e.target.value as any)} style={{ width: "100%" }}>
              {CURRENCIES.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("due_days") || "Zahlungsziel (Tage)"}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="number"
                min={0}
                placeholder=""
                value={dueDaysDraft}
                onChange={(e) => {
                  // Do NOT patch invoice while user types
                  setDueDaysDraft(e.target.value);
                }}
                onBlur={() => commitDueDays(dueDaysDraft)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                    commitDueDays(dueDaysDraft);
                  }
                }}
                style={{ width: "100%" }}
              />
              <button
                type="button"
                onClick={() => {
                  setDueDaysDraft("");
                  patchInvoice({ dueDays: undefined } as any);
                }}
                title={t("remove") || "Remove"}
              >
                ×
              </button>
            </div>
          </div>
          <div style={{ gridColumn: "1 / span 2" }}>
            <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("object") || "Objekt"}</label>
            <input
              placeholder={t("object_placeholder") || "z.B. Projekt / Baustelle"}
              value={(invoice as any).object || ""}
              onChange={(e) => patchInvoice({ object: e.target.value } as any)}
              style={{ width: "100%" }}
            />
          </div>
        </section>

        {/* Dates */}
        <section style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>{t("section_dates") || "Dates"}</h3>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("issue_date") || "Rechnungsdatum"}</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="date"
                  value={normalizeISODate((invoice as any)?.issueDateISO || "")}
                  onChange={(e) => patchInvoice({ issueDateISO: e.target.value } as any)}
                  style={{ width: "100%" }}
                />
                <button
                  type="button"
                  onClick={() => patchInvoice({ issueDateISO: "" } as any)}
                  title={t("clear") || "Clear"}
                >
                  ×
                </button>
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("billing_period") || "Abrechnungszeitraum"}</label>
              <select
                value={periodMode}
                onChange={(e) => applyPeriodMode(e.target.value as PeriodMode)}
                style={{ width: "100%" }}
              >
                <option value="none">{t("period_none") || "Ohne Zeitraum"}</option>
                <option value="month">{t("period_month") || "Monat"}</option>
                <option value="week">{t("period_week") || "Woche"}</option>
                <option value="year">{t("period_year") || "Jahr"}</option>
                <option value="custom">{t("period_custom") || "Benutzerdefiniert"}</option>
              </select>
            </div>
          </div>

          {/* Presets */}
          {periodMode === "month" && (
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("select_month") || "Monat wählen"}</label>
                <input
                  type="month"
                  value={periodMonthDraft}
                  onChange={(e) => {
                    // do NOT patch invoice while user types — it can interrupt typing
                    setPeriodMonthDraft(e.target.value);
                  }}
                  onBlur={() => commitMonth(periodMonthDraft)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                      commitMonth(periodMonthDraft);
                    }
                  }}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ alignSelf: "end", fontSize: 12, opacity: 0.75 }}>
                {(invoice as any)?.servicePeriod?.fromISO && (invoice as any)?.servicePeriod?.toISO
                  ? `${(invoice as any).servicePeriod.fromISO} → ${(invoice as any).servicePeriod.toISO}`
                  : ""}
              </div>
            </div>
          )}

          {periodMode === "week" && (
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("select_week") || "Woche (Datum wählen)"}</label>
                <input
                  type="date"
                  value={periodWeekAnchor}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPeriodWeekAnchor(v);
                    const r = weekToRange(v);
                    if (r) patchInvoice({ servicePeriod: r } as any);
                  }}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ alignSelf: "end", fontSize: 12, opacity: 0.75 }}>
                {(invoice as any)?.servicePeriod?.fromISO && (invoice as any)?.servicePeriod?.toISO
                  ? `${(invoice as any).servicePeriod.fromISO} → ${(invoice as any).servicePeriod.toISO}`
                  : ""}
              </div>
            </div>
          )}

          {periodMode === "year" && (
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("select_year") || "Jahr wählen"}</label>
                <input
                  type="number"
                  min={1900}
                  max={3000}
                  value={periodYear}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPeriodYear(v);
                    const r = yearToRange(v);
                    if (r) patchInvoice({ servicePeriod: r } as any);
                  }}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ alignSelf: "end", fontSize: 12, opacity: 0.75 }}>
                {(invoice as any)?.servicePeriod?.fromISO && (invoice as any)?.servicePeriod?.toISO
                  ? `${(invoice as any).servicePeriod.fromISO} → ${(invoice as any).servicePeriod.toISO}`
                  : ""}
              </div>
            </div>
          )}

          {/* Custom range */}
          {periodMode === "custom" && (
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("service_from") || "Von"}</label>
                <input
                  type="date"
                  value={normalizeISODate((invoice as any)?.servicePeriod?.fromISO || "")}
                  onChange={(e) => setServicePeriod({ fromISO: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("service_to") || "Bis"}</label>
                <input
                  type="date"
                  value={normalizeISODate((invoice as any)?.servicePeriod?.toISO || "")}
                  onChange={(e) => setServicePeriod({ toISO: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ gridColumn: "1 / span 2", display: "flex", gap: 8 }}>
                <button type="button" onClick={() => clearServicePeriod()}>
                  {t("remove_period") || "Zeitraum entfernen"}
                </button>
              </div>
            </div>
          )}

          {periodMode === "none" && (
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
              {t("period_disabled_hint") || "Kein Abrechnungszeitraum wird auf dem Dokument angezeigt."}
            </div>
          )}
        </section>

        {/* Document options (title/number/file name) */}
        <section style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div style={{ gridColumn: "1 / span 2" }}>
            <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("document_title") || "Document title"}</label>
            <input
              value={(invoice as any).documentTitle || ""}
              onChange={(e) => patchInvoice({ documentTitle: e.target.value } as any)}
              placeholder="Invoice"
              style={{ width: "100%" }}
            />
          </div>
          {/* Numbering mode and number controls */}
          <div>
            <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("numbering_mode") || "Numbering mode"}</label>
            <select
              value={invoice.numberingMode ?? "auto"}
              onChange={e => patchInvoice({ numberingMode: e.target.value as NumberingMode })}
              style={{ width: "100%" }}
            >
              <option value="auto">{t("numbering_auto") || "Auto"}</option>
              <option value="manual">{t("numbering_manual") || "Manual"}</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("number") || "Number"}</label>
            <input
              value={invoice.number || ""}
              onChange={e => patchInvoice({ number: e.target.value })}
              placeholder={t("number") || "Number"}
              style={{ width: "100%" }}
              disabled={(invoice.numberingMode ?? "auto") === "auto"}
            />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={Boolean((invoice as any).showNumberInTitle)}
              onChange={(e) => patchInvoice({ showNumberInTitle: e.target.checked } as any)}
            />
            <span>{t("show_number_in_title") || "Show number in title"}</span>
          </label>
          <div>
            <label style={{ display: "block", fontSize: 12, opacity: 0.7 }}>{t("filename") || "Filename"}</label>
            <input
              value={(invoice as any).fileName || ""}
              onChange={(e) => patchInvoice({ fileName: e.target.value } as any)}
              placeholder="invoice"
              style={{ width: "100%" }}
            />
          </div>
        </section>

        {/* Items */}
        <section style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>{t("section_items")}</h3>
          <datalist id="invoice-item-groups">
            {Array.from(new Set(invoice.items.map((item) => (item.group || "").trim()).filter(Boolean))).map((group) => (
              <option key={group} value={group} />
            ))}
          </datalist>
          {invoice.items.map((it, i) => (
            <div key={i} className="invoice-item-card">
              <div className="invoice-item-card__top">
                <div className="invoice-item-field">
                  <label htmlFor={`item-group-${i}`}>{t("item_group_placeholder") || "Object / group"}</label>
                  <input
                    id={`item-group-${i}`}
                    list="invoice-item-groups"
                    value={it.group || ""}
                    onChange={(e) => updateItem(i, { group: e.target.value })}
                    placeholder={t("item_group_placeholder") || "Object / group"}
                    title={t("item_group_hint") || "Items with the same group are shown together under one heading."}
                  />
                </div>
                <div className="invoice-item-field invoice-item-field--description">
                  <label htmlFor={`item-description-${i}`}>{t("description")}</label>
                  <RichDescriptionEditor
                    id={`item-description-${i}`}
                    item={it}
                    placeholder={t("description")}
                    boldLabel={t("description_bold") || "Bold"}
                    boldHint={t("description_bold_hint") || "Select text and press Cmd+B or Ctrl+B"}
                    calendarLabel={t("month_calc_button") || "Monthly calculation"}
                    calendarHint={t("month_calc_button_hint") || "Choose working days or selected dates"}
                    onOpenMonthCalculator={() => setMonthlyCalculationItemIndex(i)}
                    onChange={(patch) => updateItem(i, patch)}
                  />
                </div>
                <button type="button" className="invoice-item-remove" onClick={() => removeItem(i)}>
                  {t("remove")}
                </button>
              </div>

              <div className="invoice-item-card__values">
                <div className="invoice-item-field">
                  <label htmlFor={`item-qty-${i}`}>{t("qty")}</label>
                  <input
                    id={`item-qty-${i}`}
                    type="text"
                    inputMode="numeric"
                    value={String(it.qty ?? "")}
                    onChange={(e) => {
                      const v = (e.target.value || "").replace(",", ".");
                      const n = v.trim() === "" ? 0 : parseFloat(v);
                      updateItem(i, { qty: Number.isFinite(n) ? n : 0 });
                    }}
                    placeholder={t("qty")}
                  />
                </div>
                <div className="invoice-item-field">
                  <label htmlFor={`item-unit-${i}`}>{t("unit")}</label>
                  <input
                    id={`item-unit-${i}`}
                    value={it.unit || ""}
                    onChange={(e) => updateItem(i, { unit: e.target.value })}
                    placeholder={t("unit")}
                  />
                </div>
                <div className="invoice-item-field">
                  <label htmlFor={`item-price-${i}`}>{t("unit_price")}</label>
                  <input
                    id={`item-price-${i}`}
                    type="text"
                    inputMode="decimal"
                    value={String(it.unitPrice ?? "")}
                    onChange={(e) => {
                      const v = (e.target.value || "").replace(",", ".");
                      const n = v.trim() === "" ? 0 : parseFloat(v);
                      updateItem(i, { unitPrice: Number.isFinite(n) ? n : 0 });
                    }}
                    placeholder={t("unit_price")}
                  />
                </div>
                <div className="invoice-item-field">
                  <label htmlFor={`item-vat-${i}`}>{t("vat_rate")}</label>
                  <input
                    id={`item-vat-${i}`}
                    type="text"
                    inputMode="numeric"
                    value={String(it.vatRate ?? "")}
                    onChange={(e) => {
                      const v = (e.target.value || "").replace(",", ".");
                      const n = v.trim() === "" ? 0 : parseFloat(v);
                      updateItem(i, { vatRate: Number.isFinite(n) ? n : 0 });
                    }}
                    placeholder={t("vat_rate")}
                  />
                </div>
              </div>
            </div>
          ))}
          <button onClick={() => addItem({ qty: 1, unitPrice: 0, vatRate: 19 })} style={{ marginTop: 6 }}>{t("add_item")}</button>
        </section>

        {/* Totals (quick view) */}
        <section style={{ marginTop: 16, fontSize: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>{t("subtotal") || "Subtotal"}</div>
            <div>{totals.subtotalNet.toFixed(2)}</div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <div>{"VAT"}</div>
            <div>{totals.vatTotal.toFixed(2)}</div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
            <div>{t("total") || "Total"}</div>
            <div>{totals.grand.toFixed(2)}</div>
          </div>
        </section>

        {/* Actions */}
        <section style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
              padding: "10px 12px",
              border: "1px solid #e5e7eb",
              borderRadius: 14,
            }}
          >
            <span style={{ fontSize: 12, opacity: 0.8, fontWeight: 600 }}>{t("templates") || "Templates"}</span>
            <select
              value={selectedTemplateId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedTemplateId(id);
                const tpl = templates.find((item) => item.id === id);
                setIncludeItemsInTemplate(tpl ? Boolean(tpl.includeItems || Array.isArray(tpl.data.items)) : true);
              }}
              style={{ minWidth: 180 }}
              title={t("templates") || "Templates"}
            >
              <option value="">{t("template_select") || "Select…"}</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.id === defaultTemplateId ? "★ " : ""}{tpl.name}
                </option>
              ))}
            </select>
            <label
              title={t("template_include_items_hint") || "Store and restore descriptions, quantity, units, prices and VAT."}
              style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", fontSize: 13 }}
            >
              <input
                type="checkbox"
                checked={includeItemsInTemplate}
                onChange={(e) => setIncludeItemsInTemplate(e.target.checked)}
              />
              <span>{t("template_include_items") || "Save items and descriptions"}</span>
            </label>
            <button type="button" onClick={onApplyTemplate} disabled={!selectedTemplateId}>
              {t("template_apply") || "Apply"}
            </button>
            <button type="button" onClick={onSaveTemplateAs}>
              {t("template_save_as") || "Save as…"}
            </button>
            <button type="button" onClick={onDeleteTemplate} disabled={!selectedTemplateId}>
              {t("template_delete") || "Delete"}
            </button>
            <button type="button" onClick={onRenameTemplate} disabled={!selectedTemplateId}>
              {t("template_rename") || "Rename"}
            </button>
            <button type="button" onClick={onUpdateTemplate} disabled={!selectedTemplateId}>
              {t("template_update") || "Update"}
            </button>
            <button type="button" onClick={onToggleDefaultTemplate} disabled={!selectedTemplateId} title={t("template_default") || "Set default"}>
              {selectedTemplateId && selectedTemplateId === defaultTemplateId ? (t("template_default_clear") || "Default ✓") : (t("template_default_set") || "Make default")}
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              applyThemePreset?.("receiptPro");
              setShowPalette(true);
            }}
            style={{ borderRadius: 14, padding: "10px 14px" }}
            title="Apply Receipt Pro style"
          >
            Receipt Pro
          </button>
          <button
            type="button"
            onClick={() => {
              clearTheme?.();
              setShowPalette(false);
            }}
            style={{ borderRadius: 14, padding: "10px 14px" }}
            title="Reset to classic"
          >
            Classic
          </button>
          <button
            type="button"
            onClick={() => setShowPalette((v) => !v)}
            style={{ borderRadius: 14, padding: "10px 14px" }}
            title="Customize colors"
          >
            Palette
          </button>

          {showPalette && (
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
                padding: "10px 12px",
                border: "1px solid #e5e7eb",
                borderRadius: 16,
              }}
            >
              <label style={{ fontSize: 12, opacity: 0.8 }}>
                Primary{" "}
                <input
                  type="color"
                  value={(invoice as any)?.theme?.colors?.primary || "#0B1220"}
                  onChange={(e) => patchThemeColors?.({ primary: e.target.value })}
                  style={{ marginLeft: 6 }}
                />
              </label>

              <label style={{ fontSize: 12, opacity: 0.8 }}>
                Accent{" "}
                <input
                  type="color"
                  value={(invoice as any)?.theme?.colors?.accent || "#0B1220"}
                  onChange={(e) => patchThemeColors?.({ accent: e.target.value })}
                  style={{ marginLeft: 6 }}
                />
              </label>

              <label style={{ fontSize: 12, opacity: 0.8 }}>
                Text{" "}
                <input
                  type="color"
                  value={(invoice as any)?.theme?.colors?.text || "#0B1220"}
                  onChange={(e) => patchThemeColors?.({ text: e.target.value })}
                  style={{ marginLeft: 6 }}
                />
              </label>

              <label style={{ fontSize: 12, opacity: 0.8 }}>
                Muted{" "}
                <input
                  type="color"
                  value={(invoice as any)?.theme?.colors?.mutedText || "#6B7280"}
                  onChange={(e) => patchThemeColors?.({ mutedText: e.target.value })}
                  style={{ marginLeft: 6 }}
                />
              </label>

              <label style={{ fontSize: 12, opacity: 0.8 }}>
                BG{" "}
                <input
                  type="color"
                  value={(invoice as any)?.theme?.colors?.background || "#FFFFFF"}
                  onChange={(e) => patchThemeColors?.({ background: e.target.value })}
                  style={{ marginLeft: 6 }}
                />
              </label>

              <label style={{ fontSize: 12, opacity: 0.8 }}>
                Surface{" "}
                <input
                  type="color"
                  value={(invoice as any)?.theme?.colors?.surface || "#F6F8FB"}
                  onChange={(e) => patchThemeColors?.({ surface: e.target.value })}
                  style={{ marginLeft: 6 }}
                />
              </label>

              <label style={{ fontSize: 12, opacity: 0.8 }}>
                Border{" "}
                <input
                  type="color"
                  value={(invoice as any)?.theme?.colors?.border || "#E6EAF0"}
                  onChange={(e) => patchThemeColors?.({ border: e.target.value })}
                  style={{ marginLeft: 6 }}
                />
              </label>

              <label style={{ fontSize: 12, opacity: 0.8 }}>
                Grad from{" "}
                <input
                  type="color"
                  value={(invoice as any)?.theme?.colors?.gradientFrom || (invoice as any)?.theme?.colors?.primary || "#0B1220"}
                  onChange={(e) => patchThemeColors?.({ gradientFrom: e.target.value })}
                  style={{ marginLeft: 6 }}
                />
              </label>

              <label style={{ fontSize: 12, opacity: 0.8 }}>
                Grad to{" "}
                <input
                  type="color"
                  value={(invoice as any)?.theme?.colors?.gradientTo || (invoice as any)?.theme?.colors?.accent || "#0B1220"}
                  onChange={(e) => patchThemeColors?.({ gradientTo: e.target.value })}
                  style={{ marginLeft: 6 }}
                />
              </label>

              <label style={{ fontSize: 12, opacity: 0.8 }}>
                Round{" "}
                <input
                  type="range"
                  min={0}
                  max={24}
                  value={(invoice as any)?.theme?.layout?.roundness ?? 18}
                  onChange={(e) => setThemeRoundness?.(parseInt(e.target.value, 10))}
                  style={{ marginLeft: 6 }}
                />
                <span style={{ marginLeft: 6, fontSize: 12, opacity: 0.8 }}>
                  {((invoice as any)?.theme?.layout?.roundness ?? 18)}px
                </span>
              </label>
            </div>
          )}

          <button onClick={onOpenPreview}>{t("preview")}</button>
          <button onClick={onRenderPDF}>{t("generate_pdf")}</button>
          <button onClick={onRenderDOCX}>{t("generate_docx") || "Generate Word"}</button>
          <button onClick={onRenderAll}>{t("generate_all")}</button>
          <button onClick={onDownloadLastData}>{t("download_last_data") || "Letzte Daten herunterladen"}</button>
        </section>
      </div>

      {/* Right column: live preview */}
        <PreviewPane invoice={invoice} language={invoiceLang} debounceMs={250} />
      </div>

      {monthlyCalculationItemIndex !== null && monthlyCalculationItem && (
        <MonthlyCalculationDialog
          key={monthlyCalculationItemIndex}
          value={monthlyCalculationItem.monthlyCalculation}
          defaultMonth={
            /^\d{4}-\d{2}/.test(invoice.issueDateISO || "")
              ? invoice.issueDateISO.slice(0, 7)
              : currentMonthValue()
          }
          lang={uiLang as Lang}
          currency={invoice.currency}
          unitPrice={monthlyCalculationItem.unitPrice || 0}
          t={t}
          onClose={() => setMonthlyCalculationItemIndex(null)}
          onClear={() => {
            updateItem(monthlyCalculationItemIndex, { monthlyCalculation: undefined });
            setMonthlyCalculationItemIndex(null);
          }}
          onApply={(calculation) => {
            const calculatedQuantity = calculation.detailed
              ? (calculation.dailyEntries || []).reduce(
                  (sum, entry) => sum + entry.people * entry.hours,
                  0
                )
              : calculation.selectedDates.length;
            updateItem(monthlyCalculationItemIndex, {
              monthlyCalculation: {
                ...calculation,
                selectedDates: [...calculation.selectedDates],
                dailyEntries: calculation.dailyEntries?.map((entry) => ({ ...entry })),
              },
              qty: calculatedQuantity,
              unit:
                calculation.detailed && !monthlyCalculationItem.unit?.trim()
                  ? "h"
                  : monthlyCalculationItem.unit,
            });
            setMonthlyCalculationItemIndex(null);
          }}
        />
      )}
    </>
  );
}
