import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";

// Runtime launcher:
// - Vercel Linux (serverless): Puppeteer + @sparticuz/chromium
// - Local dev (macOS/Windows/Linux): Playwright
//
// NOTE: `process.env.VERCEL` can sometimes be set locally by tooling.
// To avoid `spawn Unknown system error -8` on macOS/Windows, we only enable
// Sparticuz when running on Linux.
const VERCEL_RAW = String(process.env.VERCEL || "").toLowerCase();
const IS_VERCEL = VERCEL_RAW === "1" || VERCEL_RAW === "true";
const IS_LINUX = process.platform === "linux";
const IS_DARWIN = process.platform === "darwin";
const PDF_DEBUG = ["1", "true", "yes"].includes(String(process.env.PDF_DEBUG || "").toLowerCase());

// Optional override for debugging:
//   PDF_ENGINE=playwright  -> force Playwright everywhere
//   PDF_ENGINE=puppeteer   -> force Puppeteer (requires Linux-compatible chromium)
const PDF_ENGINE = String(process.env.PDF_ENGINE || "").toLowerCase();
const USE_SPARTICUZ = (PDF_ENGINE ? PDF_ENGINE === "puppeteer" : IS_VERCEL) && IS_LINUX;

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

  if (USE_SPARTICUZ) {
    const { default: chromium } = await import("@sparticuz/chromium");
    const puppeteer = await import("puppeteer-core");

    const executablePath = await (chromium as any).executablePath();

    sharedBrowser = await (puppeteer as any).launch({
      args: (chromium as any).args,
      executablePath,
      headless: true,
    });

    return sharedBrowser;
  }

  // Local dev (and non-Linux runtimes): prefer system Chrome via puppeteer-core.
  // This avoids many macOS spawn issues (e.g. -8) caused by incompatible bundled browsers.
  const puppeteer = await import("puppeteer-core");

  if (PDF_DEBUG) {
    console.log(
      `[pdf] USE_SPARTICUZ=${USE_SPARTICUZ} platform=${process.platform} arch=${process.arch} engine=${PDF_ENGINE || "auto"}`
    );
  }

  // Try system Chrome paths
  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const winChrome1 = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const winChrome2 = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";

  const sysExec =
    (IS_DARWIN && fsSync.existsSync(macChrome) && macChrome) ||
    (process.platform === "win32" && fsSync.existsSync(winChrome1) && winChrome1) ||
    (process.platform === "win32" && fsSync.existsSync(winChrome2) && winChrome2) ||
    "";

  if (sysExec) {
    try {
      // On macOS/Windows we don't need no-sandbox flags and they sometimes cause issues.
      const args = IS_LINUX ? ["--no-sandbox", "--disable-setuid-sandbox"] : [];

      sharedBrowser = await (puppeteer as any).launch({
        executablePath: sysExec,
        headless: true,
        args,
      });
      return sharedBrowser;
    } catch (e) {
      if (PDF_DEBUG) console.log("[pdf] Failed to launch system Chrome via puppeteer-core, falling back...", e);
    }
  } else {
    if (PDF_DEBUG) console.log("[pdf] System Chrome not found at expected paths; falling back to Playwright");
  }

  // Fallback: Playwright (requires `npx playwright install chromium` once)
  const { chromium } = await import("playwright");
  try {
    sharedBrowser = await chromium.launch({ headless: true });
    return sharedBrowser;
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("Unknown system error -8") || msg.includes("error -8")) {
      throw new Error(
        "Failed to launch Chromium locally (spawn -8). " +
          "Install Google Chrome (recommended) or run: `cd web && npx playwright install chromium`, " +
          "then restart `npm run dev`. Original error: " +
          msg
      );
    }
    throw e;
  }
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
      await page.setContent(html, { waitUntil: "networkidle0" as any });
    } catch {
      try {
        await page.setContent(html, { waitUntil: "networkidle" as any });
      } catch {
        await page.setContent(html);
      }
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
      await page.setContent(html, { waitUntil: "networkidle0" as any });
    } catch {
      try {
        await page.setContent(html, { waitUntil: "networkidle" as any });
      } catch {
        await page.setContent(html);
      }
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