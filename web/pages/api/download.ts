import type { NextApiRequest, NextApiResponse } from "next";
import path from "node:path";
import fs from "node:fs";

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

// In Next dev, `process.cwd()` is typically `.../invoicegener/web`.
// Support both `web/out` and repo-root `out` (old Express behavior), plus TMPDIR.
const OUT_DIR_WEB = path.resolve(process.cwd(), "out");
const OUT_DIR_REPO = path.resolve(process.cwd(), "..", "out");
const TMP_OUT_DIR = path.resolve(process.env.TMPDIR || "/tmp", "out");

function isInsideDir(abs: string, dir: string) {
  return abs === dir || abs.startsWith(dir + path.sep);
}

function resolveDownloadPath(filePath: string): string | null {
  const raw = String(filePath || "").trim();
  if (!raw) return null;

  const candidates: string[] = [];

  if (path.isAbsolute(raw)) {
    candidates.push(path.resolve(raw));
  } else {
    candidates.push(path.resolve(path.join(OUT_DIR_WEB, raw)));
    candidates.push(path.resolve(path.join(OUT_DIR_REPO, raw)));
    candidates.push(path.resolve(path.join(TMP_OUT_DIR, raw)));
  }

  for (const abs of candidates) {
    const ok =
      isInsideDir(abs, OUT_DIR_WEB) ||
      isInsideDir(abs, OUT_DIR_REPO) ||
      isInsideDir(abs, TMP_OUT_DIR);
    if (!ok) continue;

    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
    } catch {
      // ignore
    }
  }

  return null;
}

function sanitizeDownloadName(name: string): string {
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
  return `${type}; filename="${safe}"; filename*=UTF-8''${encoded}`;
}

function setCors(res: NextApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET,OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const filePath = String(req.query.path || "").trim();
    let name = String(req.query.name || "").trim();

    if (!filePath) return res.status(400).json({ error: "path is required" });

    const abs = resolveDownloadPath(filePath);
    if (!abs) return res.status(404).json({ error: "not found" });

    if (name && (name.includes("/") || name.includes("\\"))) {
      name = path.basename(name);
    }

    const inline =
      String(req.query.inline || "").trim() === "1" ||
      String(req.query.disposition || "").toLowerCase() === "inline";

    const finalName = sanitizeDownloadName(name || path.basename(abs));

    const stat = fs.statSync(abs);
    const stream = fs.createReadStream(abs);

    res.setHeader("Content-Type", contentTypeFor(abs));
    res.setHeader("Content-Disposition", contentDispositionHeader(finalName, inline));
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("Last-Modified", stat.mtime.toUTCString());
    res.setHeader("ETag", `${stat.mtimeMs}-${stat.size}`);
    res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
    res.setHeader("X-Content-Type-Options", "nosniff");

    await new Promise<void>((resolve, reject) => {
      stream.on("error", reject);
      res.on("close", resolve);
      stream.pipe(res);
    });

    return;
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || String(e) });
  }
}