import type { NextApiRequest, NextApiResponse } from "next";
import { renderInvoiceHtml } from "../../server/lib/template";

// Increase body limit because invoices can include long notes / extra tables / base64 image URLs.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

function guessBaseUrl(req: NextApiRequest) {
  const proto = (req.headers["x-forwarded-proto"] as string) || "http";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "localhost";
  return `${proto}://${host}`;
}

function safeFileName(name: string) {
  return (name || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z0-9._\- ()\[\]]/g, "")
    .slice(0, 120);
}

function sanitizeHtmlForDocx(html: string): string {
  let out = html || "";

  // Drop doctype to avoid parser edge-cases
  out = out.replace(/<!doctype[^>]*>/gi, "");

  // Remove <head> entirely (it may contain CSS @-rules that some converters choke on)
  out = out.replace(/<head[\s\S]*?<\/head>/gi, "");

  // Remove any remaining <style> blocks (inlineStyles already inlines the important bits)
  out = out.replace(/<style[\s\S]*?<\/style>/gi, "");

  // Remove <link rel="stylesheet"> tags
  out = out.replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, "");

  // Prefer only the body contents
  const m = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(out);
  if (m && m[1]) out = m[1];

  // Some templates include HTML comments; remove them
  out = out.replace(/<!--([\s\S]*?)-->/g, "");

  // html-to-docx is fragile with complex CSS. Strip inline styles to avoid invalid XML (@w) crashes.
  // Layout will still be readable thanks to tables/headings.
  out = out.replace(/\sstyle=("[^"]*"|'[^']*')/gi, "");

  return out.trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = (req.body || {}) as any;

    // UI sends { data: invoice, language, fileName }. Unwrap it.
    const invoice = (body.data || body) as any;

    const language = body?.language ?? invoice?.language;
    const baseUrl = body?.baseUrl || guessBaseUrl(req);

    // Reuse the SAME HTML that we already use for PDF generation.
    // This keeps all your "tricks": themeStyle, translations via t(), rows, totals, etc.
    const html = await renderInvoiceHtml(
      { ...invoice, language },
      { inlineStyles: true, language, baseUrl }
    );

    // Convert HTML -> DOCX
    // We intentionally depend on an external converter package.
    // Install once:
    //   npm i html-to-docx
    // or:
    //   yarn add html-to-docx
    // or:
    //   pnpm add html-to-docx
    let htmlToDocx: any;
    try {
      htmlToDocx = (await import("html-to-docx")).default;
    } catch (e: any) {
      const msg = String(e?.message || e);
      const isMissing = msg.includes("Cannot find module") || msg.includes("ERR_MODULE_NOT_FOUND");
      return res.status(500).json({
        error: isMissing
          ? "Missing dependency: html-to-docx. Install it (npm i html-to-docx) and restart the dev server."
          : `Failed to load html-to-docx: ${msg}`,
      });
    }

    const htmlForDocx = sanitizeHtmlForDocx(html);
    const docxBuffer: Buffer = await htmlToDocx(htmlForDocx, undefined, {
      // keep CSS as much as possible
      // (html-to-docx supports a subset; tables work well for invoices)
      pageNumber: false,
    });

    const baseName = safeFileName(body?.fileName || invoice?.fileName || invoice?.number || "Invoice");
    const file = baseName ? `${baseName}.docx` : "Invoice.docx";

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${file}"`);
    res.setHeader("Cache-Control", "no-store");

    return res.status(200).send(docxBuffer);
  } catch (e: any) {
    return res.status(500).json({
      error: `renderDocx failed: ${String(e?.message || e)}`,
    });
  }
}