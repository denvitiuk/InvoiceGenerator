// @ts-nocheck
import type { Express, Request, Response } from "express";
import multer from "multer";
import * as path from "node:path";
import * as fs from "node:fs";

const uploadDir = (process.env.VERCEL
  ? path.join(process.env.TMPDIR || "/tmp", "uploads") // ephemeral on Vercel
  : path.join(process.cwd(), "assets", "uploads")      // local dev / self-host
);

// Ensure upload directory exists
function ensureUploadDir() {
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
  } catch (e) {
    // ignore mkdir race conditions, but if truly impossible to write -> throw later on upload
  }
}

// Allowed mime types (extend as needed)
const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "application/pdf",
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureUploadDir();
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const base = path.parse(file.originalname).name.replace(/[^a-z0-9._-]+/gi, "_");
    const ext = (path.extname(file.originalname) || "").toLowerCase() || ".bin";
    cb(null, `${base}-${Date.now()}${ext}`);
  },
});

const uploadMw = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype) || file.mimetype.startsWith("image/")) return cb(null, true);
    return cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
}).single("file");

function buildFileResponse(f: any) {
  // NOTE: on Vercel the file physically lives in /tmp, which is NOT public.
  // Frontend can still take this path and immediately POST it back to /download later
  // or embed as logoPath on invoice, etc. We just standardize what we return.

  const safeName = typeof f.originalname === 'string' ? f.originalname : 'file';

  return {
    ok: true,
    // We do NOT expose absolute FS path. We expose a logical path the app can remember.
    // Caller can later send this back and we can stream it via /download.
    storedPath: f.path, // absolute tmp path for now (server-only truth)
    filename: f.filename,
    originalName: safeName,
    size: f.size,
    mimetype: f.mimetype,
  };
}

export default function registerUpload(app: Express) {
  app.post("/upload", (req: Request, res: Response) => {
    uploadMw(req, res, (err) => {
      if (err) {
        return res.status(400).json({ ok: false, error: (err as Error).message });
      }
      const f = (req as any).file as any | undefined;
      if (!f) return res.status(400).json({ ok: false, error: "No file uploaded" });

      return res.json(buildFileResponse(f));
    });
  });

  // simple health/debug endpoints so we can confirm routing works on Vercel
  app.get("/upload", (_req: Request, res: Response) => {
    res.type("html").send("<!doctype html><meta charset=\"utf-8\"><body>OK /upload</body>");
  });

  app.get("/upload/health", (_req: Request, res: Response) => {
    res.json({ ok: true, dir: uploadDir });
  });
}
