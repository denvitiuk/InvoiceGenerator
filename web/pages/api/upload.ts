import type { NextApiRequest, NextApiResponse } from "next";
// If WebStorm still can't see `@types/multer`, this silences TS7016.
// (You can remove this once `@types/multer` is installed in `web` and the IDE re-indexes.)
// @ts-ignore
import multer from "multer";
import path from "node:path";
import fs from "node:fs";

export const config = {
  api: {
    // multer needs the raw request stream
    bodyParser: false,
    responseLimit: false,
  },
};

function setCors(res: NextApiResponse) {
  // If your UI calls same-origin (/api/*), CORS is not required.
  // Keeping permissive headers matches the old Express behavior.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

// In Next dev, cwd is usually /web. In the old Express setup uploads lived in repo root assets.
const uploadDir = process.env.VERCEL
  ? path.join(process.env.TMPDIR || "/tmp", "uploads") // ephemeral on Vercel
  : path.resolve(process.cwd(), "..", "assets", "uploads"); // local dev / self-host

function ensureUploadDir() {
  fs.mkdirSync(uploadDir, { recursive: true });
}

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
  destination: (_req: any, _file: any, cb: any) => {
    try {
      ensureUploadDir();
      cb(null, uploadDir);
    } catch (e: any) {
      cb(e);
    }
  },
  filename: (_req: any, file: any, cb: any) => {
    const base = path.parse(file.originalname).name.replace(/[^a-z0-9._-]+/gi, "_");
    const ext = (path.extname(file.originalname) || "").toLowerCase() || ".bin";
    cb(null, `${base}-${Date.now()}${ext}`);
  },
});

const uploadMw = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req: any, file: any, cb: any) => {
    if (ALLOWED.has(file.mimetype) || file.mimetype.startsWith("image/")) return cb(null, true);
    return cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
}).single("file");

function runMulter(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    uploadMw(req as any, res as any, (err: any) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function buildFileResponse(f: any) {
  const safeName = typeof f.originalname === "string" ? f.originalname : "file";
  return {
    ok: true,
    // On Vercel the file physically lives in /tmp/uploads (ephemeral).
    // We return the server path so subsequent server calls (rendering) can read it.
    storedPath: f.path,
    filename: f.filename,
    originalName: safeName,
    size: f.size,
    mimetype: f.mimetype,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    // Debug endpoint so you can confirm routing works
    return res.status(200).json({ ok: true, route: "/api/upload", dir: uploadDir });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET,POST,OPTIONS");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    await runMulter(req, res);
    const f = (req as any).file as any | undefined;
    if (!f) return res.status(400).json({ ok: false, error: "No file uploaded" });

    return res.status(200).json(buildFileResponse(f));
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
}
