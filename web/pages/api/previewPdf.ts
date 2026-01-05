import type { NextApiRequest, NextApiResponse } from "next";
import { renderInvoiceHtml } from "../../server/lib/template";
import {InvoiceData} from "@/types/invoice";
import {Lang} from "../../server/lib/i18n";


// Increase body size limit to match the previous Express setup
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

function setCors(res: NextApiResponse) {
  // If your UI calls same-origin (/api/*), CORS is not required.
  // Keeping permissive headers matches the old Express behavior.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

// Make preview resilient to half-empty/invalid payloads
export function normalizeInvoice(data: Partial<InvoiceData> | undefined): InvoiceData {
  const d = (data || {}) as Partial<InvoiceData>;
  const todayIso = new Date().toISOString().slice(0, 10);

  // Issue date is optional:
  // - if client sends "" (empty string) -> keep empty (do NOT default to today)
  // - if omitted/undefined -> default to today
  // - if invalid -> default to today (preview resilience)
  const issueRaw = (d as any).issueDateISO;
  let issueDateISO = todayIso;
  if (issueRaw === "") {
    issueDateISO = "";
  } else if (issueRaw != null && String(issueRaw).trim()) {
    const v = String(issueRaw).trim();
    const ok = !Number.isNaN(new Date(v).getTime());
    issueDateISO = ok ? v : todayIso;
  }

  // Keep service period only when BOTH dates are valid
  const fromISO = d.servicePeriod?.fromISO;
  const toISO = d.servicePeriod?.toISO;
  const hasFrom = !!fromISO && !Number.isNaN(new Date(String(fromISO)).getTime());
  const hasTo = !!toISO && !Number.isNaN(new Date(String(toISO)).getTime());
  const period = hasFrom && hasTo ? { fromISO: String(fromISO), toISO: String(toISO) } : undefined;

  return {
    language: (d.language as Lang) || "en",
    currency: d.currency || "EUR",
    number: d.number || "",
    issueDateISO,
    servicePeriod: period,
    dueDays: (() => {
      const raw = (d as any).dueDays;
      // Optional Zahlungsziel:
      // - if client sends "" or null/undefined -> keep undefined (means: do not show)
      // - if a valid positive integer -> keep it
      // - 0 or negative -> treat as undefined (hide)
      if (raw === "" || raw === undefined || raw === null) return undefined as any;
      const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
      if (!Number.isFinite(n) || n <= 0) return undefined as any;
      return n as any;
    })(),
    reverseCharge: !!(d as any).reverseCharge,
    kleinunternehmer: !!(d as any).kleinunternehmer,
    notes: Array.isArray(d.notes) ? d.notes : [],

    company: {
      name: d.company?.name || "—",
      addressLines: d.company?.addressLines || [],
      email: d.company?.email,
      phone: d.company?.phone,
      website: d.company?.website,
      ustId: (d.company as any)?.ustId,
      steuerNr: (d.company as any)?.steuerNr,
      iban: d.company?.iban,
      bic: d.company?.bic,
      bankName: d.company?.bankName,
      logoPath: d.company?.logoPath,
    },

    client: {
      name: d.client?.name || "—",
      addressLines: d.client?.addressLines || [],
      ustId: (d.client as any)?.ustId,
    },

    items:
      Array.isArray(d.items) && d.items.length
        ? (d.items as any)
        : [{ description: "", qty: 1, unit: "", unitPrice: 0, vatRate: 0 }],

    extraTables: d.extraTables || [],
    extraImages: d.extraImages || [],
  } as InvoiceData;
}

export async function buildPreviewHtml(input: any): Promise<string> {
  const body = (input ?? {}) as any;
  const raw = (body.data ?? body) as Partial<InvoiceData>; // accept either {data: {...}} or plain invoice JSON
  const language = (body.language ?? (raw as any).language ?? "en") as Lang;
  const data = normalizeInvoice(raw);
  // Inline styles to make preview look exactly like final PDF
  const html = await renderInvoiceHtml({ ...data, language }, { inlineStyles: true });
  return html;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send("<!doctype html><meta charset=\"utf-8\"><body>OK /api/preview</body>");
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET,POST,OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const html = await buildPreviewHtml(req.body);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e: any) {
    // Do not 400 on preview — return minimal HTML so UI doesn't crash
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res
      .status(200)
      .send(
        `<pre style="padding:12px;font-family:system-ui">Preview error: ${String(e?.message || e)}</pre>`,
      );
  }
}