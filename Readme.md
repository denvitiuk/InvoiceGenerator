# InvoiceGenerator

A pragmatic, local-first invoice generator with **live HTML preview**, **multi‑language PDFs**, and **one‑click downloads**. Built with **TypeScript + React (Vite)** on the frontend and **Node.js + Express + Playwright + Handlebars** on the backend.

---

## ✨ Features
- **Live preview** (HTML) and **PDF rendering** via Playwright (Chromium print to PDF).
- **Multi‑language invoices** out of the box: **DE, EN, RU, BG, TR, UK** (Ukrainian). UI translations for the same set of languages.
- **Currencies:** `EUR`, `USD`, `GBP`, **`UAH`**.
- **Flexible numbering:**
  - **Auto** (monthly counter, e.g. `2025-10-0014`) with safe persistence in `data/seq.json`.
  - **Manual** — user can type any text or leave it blank.
- **Document title & filename:** user can set custom **document title**, optional **show number in title**, and preferred **PDF filename**.
- **Company block** with optional **IBAN / BIC / Bank name / VAT ID / Tax number / Contacts**; rendered in the footer.
- **Extras:** additional tables, images (logo/uploads), notes, watermark, reverse‑charge, §19 UStG.
- **Presets & local memory:** save/load presets; **auto‑save to localStorage**; export **“last data”** as JSON; import back later.
- **One‑click downloads:**
  - `/render?download=1` → stream PDF directly to the browser “Downloads”.
  - `/render-all?download=1` → stream ZIP with PDFs for multiple languages.
- **Templating:** Handlebars partials + a single stylesheet for consistent print layout.

---

## 🧱 Stack
- **Frontend:** React 18/19, Vite, Zustand, TypeScript
- **Backend:** Node.js + Express, Playwright (Chromium), Handlebars, date‑fns, multer, archiver, CORS

---

## 🚀 Getting Started (Local)

> Requirements: **Node.js 18+** (20+ recommended), `npm` or `pnpm`/`yarn`.

### 1) Install
```bash
# at repo root
npm install

# frontend
cd web && npm install
```

### 2) Dev run (two terminals)
```bash
# Terminal A — backend (at repo root)
# pick the script you use in your package.json:
npm run dev:server   # e.g. tsx watch server/index.ts
# or
node --loader ts-node/esm server/index.ts

# Terminal B — frontend
cd web
npm run dev
```
Open http://localhost:5173 (Vite). The dev proxy forwards API calls to http://localhost:3001.

**Environment:**
- `web/.env` (or `.env.development`) can set `VITE_API_BASE=/api`.
- Backend listens on `PORT=3001` by default.

---

## 📦 Build & Preview
```bash
# frontend build
cd web && npm run build && npm run preview
# backend stays a regular Node service (start your server as you prefer)
```

> **Note:** PDF rendering uses Playwright. Make sure Playwright Chromium is available in your environment. In CI or first run locally you may need:
> ```bash
> npx playwright install chromium
> ```

---

## 🔌 API Overview

All endpoints are served by the backend (proxied by Vite in dev):

- `POST /preview` → **HTML** preview (returns compiled HTML string).
- `POST /preview-pdf` → **PDF bytes** for on‑screen preview (optional).
- `POST /render?download=1` → **stream PDF** to the browser (Content‑Disposition: attachment).
- `POST /render-all?download=1` → **stream ZIP** of PDFs for several languages.
- `POST /upload` → upload logo/images (stores under `assets/uploads/`).
- `GET /presets` / `POST /presets` → read/save named presets.
- `GET /download?path=...&name=...` → safe file download from `/out` (fallback method).



**Tip:** For `render-all` you may pass `{ languages: ["de","uk",...], data }` or use `all: true`.

---

## 🧩 Data Model (simplified)
See **`server/types/invoice.ts`** (also re‑exported to the frontend). Highlights:

```ts
export type Lang = "de" | "en" | "ru" | "bg" | "tr" | "uk";
export type Currency = "EUR" | "USD" | "GBP" | "UAH";
export type NumberingMode = "auto" | "manual";

export interface InvoiceData {
  language?: Lang;
  currency: Currency;
  number: string;                  // may be empty in manual mode
  numberingMode?: NumberingMode;   // auto | manual
  documentTitle?: string;          // optional heading in PDF
  showNumberInTitle?: boolean;     // print number in title
  fileName?: string;               // preferred download name (no .pdf)
  issueDateISO: string;            // ISO date
  servicePeriod?: { fromISO: string; toISO: string };
  dueDays?: number;
  reverseCharge?: boolean;
  kleinunternehmer?: boolean;      // §19 UStG
  notes?: string[];

  company: {
    name: string;
    addressLines: string[];
    email?: string; phone?: string; website?: string;
    ustId?: string; steuerNr?: string;
    iban?: string; bic?: string; bankName?: string;
    logoPath?: string;             // local path or file URL
  };

  client: { name: string; addressLines: string[]; ustId?: string };

  items: { description: string; qty: number; unit?: string; unitPrice: number; vatRate: number }[];

  extraTables?: { title?: string; columns: string[]; rows: (string|number)[][] }[];
  extraImages?: { path: string; caption?: string; maxWidthPx?: number }[];
}
```

---

## 🧰 Templates & i18n
- **Handlebars layout:** `templates/base.hbs` with partials in `templates/partials/`:
  - `header.hbs`, `parties.hbs`, `items.hbs`, `totals.hbs`, `notes.hbs`, `extras.hbs`, `footer.hbs`
- **Styles:** `templates/styles.css` — optimized for print/PDF.
- **Invoice i18n:** `i18n/invoice/{de,en,ru,bg,tr,uk}.json`
- **UI i18n:** `i18n/ui/{de,en,ru,bg,tr,uk}.json`

Dates are formatted with **date‑fns** locale (e.g. `uk` for Ukrainian). Money uses `Intl.NumberFormat` with proper locale hints (e.g. `uk-UA` for UAH).

---

## 📂 Project Structure
```
.
├─ server/
│  ├─ index.ts
│  ├─ routes/
│  │  ├─ preview.ts        # POST /preview → HTML
│  │  ├─ preview-pdf.ts    # POST /preview-pdf → PDF bytes (optional)
│  │  ├─ render.ts         # POST /render[?download=1]
│  │  ├─ render-all.ts     # POST /render-all[?download=1]
│  │  ├─ upload.ts         # POST /upload (multer)
│  │  ├─ presets.ts        # GET/POST presets
│  │  └─ download.ts       # GET /download (fallback)
│  ├─ lib/
│  │  ├─ template.ts       # Handlebars + styles + dictionaries
│  │  ├─ pdf.ts            # Playwright print-to-PDF (buffer/stream)
│  │  ├─ i18n.ts           # load dictionaries, resolve lang
│  │  └─ seq.ts            # invoice auto-number (data/seq.json)
│  └─ types/
│     └─ invoice.ts        # shared types
│
├─ web/
│  ├─ src/
│  │  ├─ components/
│  │  │  ├─ AppShell.tsx
│  │  │  ├─ Toolbar.tsx
│  │  │  └─ PreviewPane.tsx
│  │  │  └─ form/ (CompanyCard, ClientCard, DatesCard, ItemsTable, ExtraTables, ImagesBlock, NotesBlock, OptionsBlock)
│  │  ├─ lib/ (store.ts, api.ts, i18n.ts)
│  │  ├─ types/ (re-exported server types if needed)
│  │  ├─ main.tsx, app.css
│  ├─ index.html, vite.config.ts, .env*
│
├─ templates/ (base.hbs, styles.css, partials/*)
├─ i18n/
│  ├─ invoice/ {de,en,ru,bg,tr,uk}.json
│  └─ ui/      {de,en,ru,bg,tr,uk}.json
├─ assets/
│  ├─ uploads/ (user images)
│  └─ fonts/
├─ data/
│  ├─ seq.json              # auto-number state (created on demand)
│  └─ presets/ (company-default.json, clients.json, items-templates.json)
├─ out/                     # generated files (gitignored)
└─ README.md
```

---

## 🧭 Production Notes
- **Frontend** can be deployed to static hosting (e.g., Vercel). Set `VITE_API_BASE` to your API origin.
- **Backend** should run on a Node host (needs Playwright/Chromium & writable `data/` for auto-number). On serverless (ephemeral FS), prefer **manual numbering** or use an external store (Redis/KV) for the counter.
- Direct download endpoints (`?download=1`) return proper `Content-Disposition` for clean file names.

---

## 🩺 Troubleshooting
- **404 on `/render` in dev** → You’re hitting Vite directly. Ensure Vite proxy maps `/render` to `http://localhost:3001` or call the backend origin (`API_BASE`).
- **`ENOENT: .seq.json`** → switch to manual numbering or ensure `data/seq.json` is writable. The app now auto‑creates it, but the directory must be writable.
- **`Invalid time value`** → check `issueDateISO` and service period dates; must be valid ISO strings.
- **UAH not in dropdown** → ensure `CURRENCIES` includes `"UAH"` in AppShell and types include it.
- **Ukrainian not applied** → make sure language sent to backend is `"uk"` (not `"ua"`), dictionaries `i18n/invoice/uk.json` exist, and server logs show `lang: uk`.

---

## 📄 License
MIT.