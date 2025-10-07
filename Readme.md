# InvoiceGenerator

A minimalistic application for generating invoices (PDF) with live preview, templates, and automatic export to the `out/` directory.  
Built with **TypeScript + React** using **Vite**.

---

## ✨ Features
- Generate **PDF invoices** quickly with customizable templates.
- Configure company details, VAT, currency, and invoice numbering via `.env`.
- Preview invoices before downloading.
- Exported PDFs are saved in the `out/` directory (ignored by Git).
- Cross-platform support (macOS / Windows / Linux).

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** v18+ (v20 recommended)
- npm / yarn / pnpm (choose one)

### Installation & Run

```bash
# 1) Clone repository
git clone https://github.com/denvitiuk/InvoiceGenerator.git
cd InvoiceGenerator

# 2) Install dependencies
npm install
# or
yarn
# or
pnpm install

# 3) Copy environment file and configure
cp .env.example .env

# 4) Run in development mode
npm run dev

# 5) Build for production
npm run build

# 6) Preview production build
npm run preview
```

Visit [http://localhost:5173](http://localhost:5173) during development.

---



 

---

## 📂 Project Structure

```
InvoiceGenerator/
├─ web/
│  ├─ src/
│  │  ├─ lib/          # utility functions
│  │  ├─ types/        # TypeScript types
│  │  ├─ main.tsx      # React entry point
│  │  ├─ index.ts      # exports / setup
│  │  ├─ template.ts   # invoice template logic
│  │  └─ previewPdf.ts # PDF preview & generation
│  └─ vite.config.ts
├─ out/                # generated PDF files (gitignored)
├─ .env.example
├─ .gitignore
└─ README.md
```

---

## 📜 Scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

---

## 🛠 Roadmap
- Customizable invoice numbering masks (e.g. `INV-2025-10-0009`)
- Multi-language templates (DE/EN/BG/UK/RU)
- Client & bank presets
- Export/import invoice data (CSV/JSON)
- Server-side API for bulk generation

---

## 📄 License
MIT (or specify your own).