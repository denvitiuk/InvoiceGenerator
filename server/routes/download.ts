

import type { Express, Request, Response } from "express";
import path from "node:path";
import fs from "node:fs";

// Base directory where generated files live
const OUT_DIR = path.resolve(process.cwd(), "out");

function isInsideOut(p: string) {
  const abs = path.resolve(p);
  return abs === OUT_DIR || abs.startsWith(OUT_DIR + path.sep);
}

export function registerDownload(app: Express) {
  app.get("/download", (req: Request, res: Response) => {
    try {
      const filePath = String(req.query.path || "").trim();
      let name = String(req.query.name || "").trim();

      if (!filePath) return res.status(400).json({ error: "path is required" });

      const abs = path.isAbsolute(filePath) ? filePath : path.join(OUT_DIR, filePath);
      if (!isInsideOut(abs)) return res.status(400).json({ error: "invalid path" });

      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return res.status(404).json({ error: "not found" });
      }

      // Sanitize provided name (optional)
      if (name && (name.includes("/") || name.includes("\\"))) {
        name = path.basename(name);
      }

      // Let express set proper Content-Disposition
      res.download(abs, name || path.basename(abs));
    } catch (e: any) {
      res.status(400).json({ error: e?.message || String(e) });
    }
  });
}

export default registerDownload;