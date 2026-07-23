# Invoice Generator

A multilingual invoice generator for creating, previewing, and exporting professional invoices as PDF and Word documents.

The application works as a hosted Next.js service, can be used locally, and includes an optional Electron desktop workflow.

## Features

### Invoice editing

- Live HTML preview while editing.
- PDF, DOCX, and multi-language ZIP export.
- Custom invoice number, title, filename, issue date, payment term, and service period.
- Company, customer, bank, tax, and contact information.
- Multiple currencies: EUR, USD, GBP, and UAH.
- VAT, reverse-charge, and German small-business (`§19 UStG`) options.
- Company logo, custom colors, layout presets, and logo positioning.
- Additional notes, tables, and images.

### Items and descriptions

- Group related items by object, project, or site.
- Store an independent description, quantity, unit, net price, and VAT rate for every item.
- Apply bold formatting inside descriptions:
  1. Select the required text.
  2. Press **Cmd+B** on macOS or **Ctrl+B** on Windows/Linux.
  3. The same action is available through the **B** button next to the description.
- Bold formatting and line breaks are safely preserved in HTML, PDF, and DOCX output.

### Monthly calculations

The calendar attached to each item supports two calculation modes:

- **All weekdays** — automatically selects Monday through Friday for the chosen month.
- **Selected days** — allows individual dates to be selected in the calendar.

The calculation can be used in two ways:

- **Simple calculation** — the item quantity is the number of selected days.
- **Detailed daily breakdown** — creates an invoice row for every selected date.

In detailed mode, set the number of people and working hours for all days, then adjust individual dates when necessary. The application calculates:

- person-hours for each day;
- the amount for each day using the item's unit price;
- total person-hours;
- net total, VAT, and invoice total.

The exported invoice shows the main service followed by a clean daily breakdown with the date, `people × hours`, quantity, unit, rate, VAT, and daily total. The parent item is not counted twice.

For a fixed monthly fee plus hourly work, create two items: one regular item for the monthly fee and one item with the detailed daily calculation.

### Reusable templates

Templates are stored locally in the browser and can contain:

- company and invoice settings;
- design and language settings;
- optionally, all invoice items, groups, descriptions, prices, VAT rates, and monthly calculations.

Use **Save items and descriptions** when creating or updating a template if its positions should be restored later. A template can also be marked as the default.

### Languages

The interface and generated invoices support:

- English
- German
- Russian
- Bulgarian
- Turkish
- Ukrainian

Dates and monetary values are formatted according to the selected language.

## Getting started

### Requirements

- Node.js 22
- npm

### Install

From the project root:

```bash
npm install
```

The root `postinstall` script installs the web application dependencies.

### Run in development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Production build

```bash
npm run build
npm run start
```

### Optional desktop mode

Run the Electron application from the `web` directory:

```bash
cd web
npm run electron:dev
```

Desktop packages can be created with `electron:dist:mac` or `electron:dist:win`.

## API endpoints

The UI uses same-origin Next.js API routes:

- `POST /api/preview` — returns compiled invoice HTML.
- `POST /api/render?download=1` — returns a PDF download.
- `POST /api/renderDocx?download=1` — returns a DOCX download.
- `POST /api/renderAll?download=1` — returns a ZIP containing invoices in multiple languages.
- `POST /api/upload` — uploads a logo or another invoice image.

An alternative API host can be configured with `NEXT_PUBLIC_API_BASE`.

## How it works

1. The editor stores the current invoice as structured `InvoiceData`.
2. The preview API combines the data with Handlebars templates and localized labels.
3. The same model is used for the HTML preview, PDF, and DOCX output.
4. Chromium renders the print-ready PDF with A4 layout and controlled page breaks.
5. Templates and the current draft are persisted locally for reuse.

## Project structure

```text
.
├── package.json             Root development commands
└── web
    ├── pages/api            Next.js API routes
    ├── public/i18n          Interface and invoice translations
    ├── server               Rendering and localization logic
    ├── src/components       Invoice editor and preview UI
    ├── src/lib              State, API, and localization helpers
    ├── src/types            Shared invoice data types
    └── templates            Handlebars invoice templates and print CSS
```

## Technology

- TypeScript
- React and Next.js
- Zustand
- Handlebars
- `date-fns`
- `puppeteer-core` and `@sparticuz/chromium`
- `html-to-docx`
- Electron

## License

ISC
