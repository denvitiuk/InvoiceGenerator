import { chromium, type Browser } from "playwright";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface PdfOptions {
  /** Raw HTML string to render */
  html: string;
  /** Absolute or relative output path for the resulting PDF */
  outPath: string;
  /** Optional header/footer HTML (Playwright templates) */
  headerHtml?: string;
  footerHtml?: string;
  /** Page format (A4 by default) */
  format?: "A4" | "Letter" | "Legal" | string;
  /** Margins in CSS units (e.g., "18mm") */
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
  /** Landscape orientation */
  landscape?: boolean;
  /** Scale 0.1–2 */
  scale?: number;
  /** If true, uses @page size from CSS instead of format */
  preferCSSPageSize?: boolean;
}

export const DEFAULT_HEADER = `<div style="font-size:8px;width:100%;padding:0 14mm;"></div>`;
export const DEFAULT_FOOTER = `
  <div style="font-size:9px;width:100%;padding:0 14mm;color:#666;display:flex;justify-content:space-between;">
    <div></div>
    <div><span class="pageNumber"></span>/<span class="totalPages"></span></div>
  </div>
`;

let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  sharedBrowser = await chromium.launch({ headless: true });
  return sharedBrowser;
}

export async function renderPdf({
  html,
  outPath,
  headerHtml = DEFAULT_HEADER,
  footerHtml = DEFAULT_FOOTER,
  format = "A4",
  margin = { top: "18mm", right: "14mm", bottom: "18mm", left: "14mm" },
  landscape = false,
  scale = 1,
  preferCSSPageSize = false,
}: PdfOptions): Promise<string> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.emulateMedia({ media: "print" });
    const absOut = path.resolve(outPath);
    await fs.mkdir(path.dirname(absOut), { recursive: true });

    await page.pdf({
      path: absOut,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: headerHtml,
      footerTemplate: footerHtml,
      format,
      margin,
      landscape,
      scale,
      preferCSSPageSize,
    });

    const stat = await fs.stat(absOut);
    if (!stat.isFile() || stat.size < 1024) {
      throw new Error("PDF render failed: produced empty/too small file");
    }

    return absOut;
  } finally {
    await page.close();
  }
}

export interface PdfBufferOptions {
  /** Raw HTML string to render */
  html: string;
  /** Optional header/footer HTML (Playwright templates) */
  headerHtml?: string;
  footerHtml?: string;
  /** Page format (A4 by default) */
  format?: "A4" | "Letter" | "Legal" | string;
  /** Margins in CSS units (e.g., "18mm") */
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
  /** Landscape orientation */
  landscape?: boolean;
  /** Scale 0.1–2 */
  scale?: number;
  /** If true, uses @page size from CSS instead of format */
  preferCSSPageSize?: boolean;
}

export async function renderPdfBuffer({
  html,
  headerHtml = DEFAULT_HEADER,
  footerHtml = DEFAULT_FOOTER,
  format = "A4",
  margin = { top: "18mm", right: "14mm", bottom: "18mm", left: "14mm" },
  landscape = false,
  scale = 1,
  preferCSSPageSize = false,
}: PdfBufferOptions): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.emulateMedia({ media: "print" });

    const buffer = await page.pdf({
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: headerHtml,
      footerTemplate: footerHtml,
      format,
      margin,
      landscape,
      scale,
      preferCSSPageSize,
    });

    if (!buffer || buffer.byteLength < 1024) {
      throw new Error("PDF render failed: produced empty/too small buffer");
    }

    return buffer;
  } finally {
    await page.close();
  }
}

export async function closePdfBrowser() {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}