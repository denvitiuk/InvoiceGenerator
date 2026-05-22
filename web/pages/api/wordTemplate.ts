import type { NextApiRequest, NextApiResponse } from "next";
import fs from "node:fs";
import path from "node:path";

// This endpoint serves a prebuilt Word TEMPLATE (.dotx).
// The idea: user downloads it once and installs it in Word as a custom template.
// Later we can add /api/renderDocx to generate filled .docx from the same invoice data.

// Where the template file should live in the repo:
//   web/server/templates/invoice-template.dotx
// (Create this file and commit it.)
const TEMPLATE_RELATIVE_PATH = path.join("server", "templates", "invoice-template.dotx");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const absPath = path.join(process.cwd(), TEMPLATE_RELATIVE_PATH);

  try {
    const buf = await fs.promises.readFile(absPath);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.template"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="InvoiceTemplate.dotx"'
    );
    res.setHeader("Cache-Control", "no-store");

    return res.status(200).send(buf);
  } catch (e: any) {
    const msg = e?.code === "ENOENT"
      ? `Word template not found at: ${absPath}. Put your .dotx here: ${TEMPLATE_RELATIVE_PATH}`
      : `Failed to read Word template: ${String(e?.message || e)}`;

    return res.status(404).json({ error: msg });
  }
}
