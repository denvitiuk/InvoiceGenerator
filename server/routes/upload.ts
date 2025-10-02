// @ts-nocheck
import type { Express, Request, Response } from "express";
import multer from "multer";
import * as path from "node:path";
import * as fs from "node:fs";

const uploadDir = path.join(process.cwd(), "assets", "uploads");

// Ensure upload directory exists
function ensureUploadDir() {
  try { fs.mkdirSync(uploadDir, { recursive: true }); } catch {}
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

export default function registerUpload(app: Express) {
  app.post("/upload", (req: Request, res: Response) => {
    uploadMw(req, res, (err) => {
      if (err) {
        return res.status(400).json({ ok: false, error: (err as Error).message });
      }
      const f = (req as any).file as any | undefined;
      if (!f) return res.status(400).json({ ok: false, error: "No file uploaded" });

      const publicPath = `/assets/uploads/${f.filename}`;
      return res.json({
        ok: true,
        path: publicPath,
        name: f.originalname,
        size: f.size,
        mimetype: f.mimetype,
      });
    });
  });
}
