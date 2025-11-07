import type { Express, Request, Response } from "express";
import path from "node:path";
import fs from "node:fs";

// Base directory where generated files live
const OUT_DIR = path.resolve(process.cwd(), "out");
const TMP_OUT_DIR = path.resolve(process.env.TMPDIR || "/tmp", "out");

function isInsideOut(p: string) {
  const abs = path.resolve(p);
  return (
    abs === OUT_DIR ||
    abs.startsWith(OUT_DIR + path.sep) ||
    abs === TMP_OUT_DIR ||
    abs.startsWith(TMP_OUT_DIR + path.sep)
  );
}

function sanitizeDownloadName(name: string): string {
  // remove slashes and control chars; trim length
  return (name || "")
    .replace(/[\r\n]/g, " ")
    .replace(/[\\/]/g, " ")
    .trim()
    .slice(0, 200) || "file";
}

function contentTypeFor(absPath: string): string {
  const ext = path.extname(absPath).toLowerCase();
  switch (ext) {
    case ".pdf": return "application/pdf";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".svg": return "image/svg+xml";
    case ".txt": return "text/plain; charset=utf-8";
    case ".json": return "application/json";
    case ".html": return "text/html; charset=utf-8";
    default: return "application/octet-stream";
  }
}

function contentDispositionHeader(filename: string, inline: boolean): string {
  const safe = sanitizeDownloadName(filename);
  const encoded = encodeURIComponent(safe).replace(/\*/g, "%2A");
  const type = inline ? "inline" : "attachment";
  // include both filename (fallback) and RFC 5987 filename*
  return `${type}; filename="${safe}"; filename*=UTF-8''${encoded}`;
}

function sendFile(res: Response, absPath: string, filename: string, inline: boolean) {
  const stat = fs.statSync(absPath);
  const stream = fs.createReadStream(absPath);

  res.setHeader("Content-Type", contentTypeFor(absPath));
  res.setHeader("Content-Disposition", contentDispositionHeader(filename, inline));
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader("Last-Modified", stat.mtime.toUTCString());
  res.setHeader("ETag", `${stat.mtimeMs}-${stat.size}`);
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
  res.setHeader("X-Content-Type-Options", "nosniff");

  stream.on("error", (err) => {
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message || String(err) });
    } else {
      // terminate broken pipe
      try { res.end(); } catch {}
    }
  });

  stream.pipe(res);
}

export function registerDownload(app: Express) {
  app.get("/download", (req: Request, res: Response) => {
    try {
      const filePath = String(req.query.path || "").trim();
      let name = String(req.query.name || "").trim();

      if (!filePath) return res.status(400).json({ error: "path is required" });

      let abs = path.isAbsolute(filePath) ? filePath : path.join(OUT_DIR, filePath);
      if (!isInsideOut(abs)) {
        const tmpCandidate = path.join(TMP_OUT_DIR, filePath);
        if (isInsideOut(tmpCandidate)) {
          abs = tmpCandidate;
        } else {
          return res.status(400).json({ error: "invalid path" });
        }
      }

      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return res.status(404).json({ error: "not found" });
      }

      // Sanitize provided name (optional)
      if (name && (name.includes("/") || name.includes("\\"))) {
        name = path.basename(name);
      }

      const inline = String(req.query.inline || "").trim() === "1" || String(req.query.disposition || "").toLowerCase() === "inline";
      const finalName = sanitizeDownloadName(name || path.basename(abs));
      sendFile(res, abs, finalName, inline);
      return;
    } catch (e: any) {
      res.status(400).json({ error: e?.message || String(e) });
    }
  });
}

export default registerDownload;