import * as fs from "node:fs/promises";
import * as path from "node:path";

// Runtime launcher: Playwright locally, Puppeteer+Sparticuz on Vercel
const IS_VERCEL = !!process.env.VERCEL;
// We keep lax types because we may return either a Playwright or Puppeteer browser
type AnyBrowser = any;

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

let sharedBrowser: AnyBrowser | null = null;

async function getBrowser(): Promise<AnyBrowser> {
  if (sharedBrowser && (typeof sharedBrowser.isConnected !== 'function' || sharedBrowser.isConnected())) {
    return sharedBrowser;
  }

  if (IS_VERCEL) {
    const { default: chromium } = await import('@sparticuz/chromium');
    const puppeteer = await import('puppeteer-core');
    const executablePath = await (chromium as any).executablePath();
    sharedBrowser = await (puppeteer as any).launch({
      args: (chromium as any).args,
      defaultViewport: (chromium as any).defaultViewport,
      executablePath,
      headless: (chromium as any).headless,
    });
    return sharedBrowser;
  }

  // Local dev: use Playwright (lighter setup, no need for system Chrome path)
  const { chromium } = await import('playwright');
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
    try {
      await page.setContent(html, { waitUntil: 'networkidle' as any });
    } catch {
      await page.setContent(html);
    }
    if (typeof (page as any).emulateMedia === 'function') {
      await (page as any).emulateMedia({ media: 'print' });
    } else if (typeof (page as any).emulateMediaType === 'function') {
      await (page as any).emulateMediaType('print');
    }
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
    try {
      await page.setContent(html, { waitUntil: 'networkidle' as any });
    } catch {
      await page.setContent(html);
    }
    if (typeof (page as any).emulateMedia === 'function') {
      await (page as any).emulateMedia({ media: 'print' });
    } else if (typeof (page as any).emulateMediaType === 'function') {
      await (page as any).emulateMediaType('print');
    }

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