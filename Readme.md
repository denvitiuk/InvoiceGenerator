# Invoice Generator

A hosted invoice generator that turns structured invoice data into a clean HTML preview and a print‑ready PDF.

Designed to run reliably on Vercel (serverless) and produce consistent output across languages.

---

## What it does

- Generates invoices from a single source of truth (structured JSON data)
- Renders:
  - **HTML preview** (for UI/live review)
  - **PDF** (A4, margins, page breaks, deterministic layout)
- Supports **multi‑language** invoices with locale‑aware **dates** and **money formatting**
- Supports **multi‑currency** amounts (e.g. EUR/USD/GBP/UAH)
- Allows **logo/image uploads** for branding
- Can generate **multiple PDFs in one request** and return them as a **ZIP**

---

## How it works

1) The UI (or any client) sends invoice data to the API.
2) The API compiles Handlebars templates into HTML.
3) The renderer converts the HTML to PDF using headless Chromium.
4) The response is streamed back to the client (PDF or ZIP).

---

## API endpoints

- `POST /api/preview` → returns compiled **HTML**
- `POST /api/render?download=1` → streams **PDF** (`Content-Disposition: attachment`)
- `POST /api/renderAll?download=1` → streams **ZIP** (multiple PDFs)
- `POST /api/upload` → uploads logo/images referenced by templates

---

## Templates and localization

- **Templates**: Handlebars layout + partials + a single print stylesheet
- **Invoice i18n**: per‑language dictionaries for labels/text
- **Formatting**:
  - Dates: `date-fns` with locale mapping
  - Money: `Intl.NumberFormat`

---

## Tech overview

- TypeScript
- Next.js API routes (Node runtime)
- `puppeteer-core` + `@sparticuz/chromium` for serverless PDF rendering
- Handlebars for templating

---

## License

MIT