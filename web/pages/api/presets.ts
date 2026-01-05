import type { NextApiRequest, NextApiResponse } from "next";
import path from "node:path";
import fs from "node:fs";

export const config = {
  api: {
    responseLimit: false,
  },
};

function setCors(res: NextApiResponse) {
  // If your UI calls same-origin (/api/*), CORS is not required.
  // Keeping permissive headers matches the old Express behavior.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
}

// Base directories where generated / uploaded files may live.
// In Next dev, cwd is usually `<repo>/web`.
const OUT_DIR_WEB = path.resolve(process.cwd(), "out");
const OUT_DIR_REPO = path.resolve(process.cwd(), "..", "out");
const TMP_OUT_DIR = path.resolve(process.env.TMPDIR || "/tmp", "out");

const UPLOAD_DIR_WEB = path.resolve(process.cwd(), "public", "uploads");
const UPLOAD_DIR_REPO = path.resolve(process.cwd(), "..", "assets", "uploads");
const TMP_UPLOAD_DIR = path.resolve(process.env.TMPDIR || "/tmp", "uploads");

const ALLOWED_DIRS = [OUT_DIR_WEB, OUT_DIR_REPO, TMP_OUT_DIR, UPLOAD_DIR_WEB, UPLOAD_DIR_REPO, TMP_UPLOAD_DIR];

function isInsideAllowed(absPath: string) {
  const abs = path.resolve(absPath);
  return ALLOWED_DIRS.some((base) => abs === base || abs.startsWith(base + path.sep));
}

function q(req: NextApiRequest, key: string): string {
  const v = req.query[key];
  return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
}

function sanitizeDownloadName(name: string): string {
  // remove slashes and control chars; trim length
  return (
    (name || "")
      .replace(/[\r\n]/g, " ")
      .replace(/[\\/]/g, " ")
      .trim()
      .slice(0, 200) || "file"
  );
}

function contentTypeFor(absPath: string): string {
  const ext = path.extname(absPath).toLowerCase();
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".json":
      return "application/json";
    case ".html":
      return "text/html; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function contentDispositionHeader(filename: string, inline: boolean): string {
  const safe = sanitizeDownloadName(filename);
  const encoded = encodeURIComponent(safe).replace(/\*/g, "%2A");
  const type = inline ? "inline" : "attachment";
  // include both filename (fallback) and RFC 5987 filename*
  return `${type}; filename="${safe}"; filename*=UTF-8''${encoded}`;
}

function sendFile(res: NextApiResponse, absPath: string, filename: string, inline: boolean) {
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
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    } else {
      try {
        res.end();
      } catch {}
    }
  });

  // Stream the file
  stream.pipe(res);
}

function resolveRequestedPath(filePath: string): string | null {
  const trimmed = String(filePath || "").trim();
  if (!trimmed) return null;

  // Absolute path: allow only inside allowed dirs
  if (path.isAbsolute(trimmed)) {
    const abs = path.resolve(trimmed);
    return isInsideAllowed(abs) ? abs : null;
  }

  // Relative path: try each allowed base dir
  for (const base of ALLOWED_DIRS) {
    const abs = path.resolve(base, trimmed);
    if (isInsideAllowed(abs)) return abs;
  }

  return null;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET,OPTIONS");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const filePath = q(req, "path");
    let name = q(req, "name");

    if (!filePath) return res.status(400).json({ ok: false, error: "path is required" });

    const abs = resolveRequestedPath(filePath);
    if (!abs) return res.status(400).json({ ok: false, error: "invalid path" });

    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return res.status(404).json({ ok: false, error: "not found" });
    }

    // Sanitize provided name (optional)
    if (name && (name.includes("/") || name.includes("\\"))) {
      name = path.basename(name);
    }

    const inline = q(req, "inline").trim() === "1" || q(req, "disposition").toLowerCase() === "inline";
    const finalName = sanitizeDownloadName(name || path.basename(abs));

    sendFile(res, abs, finalName, inline);
    return;
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
}