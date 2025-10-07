

import express, { type Express } from "express";
import cors from "cors";
import * as path from "node:path";
import * as fs from "node:fs";

// Route registrars (reuse existing server routes, but DO NOT call app.listen here)
import registerPreview from "../routes/preview.js";
import registerRender from "../routes/render.js";
import registerRenderAll from "../routes/renderAll.js";
import registerUpload from "../routes/upload.js";
import registerPresets from "../routes/presets.js";
import registerDownload from "../routes/download.js";

// Resolve project root so templates/assets/i18n are available in a serverless env
function resolveProjectRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), "..", ".."), // /server/api -> repo root
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd()),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, "templates"))) return dir;
    } catch {}
  }
  return process.cwd();
}

const ROOT = resolveProjectRoot();

export function createApp(): Express {
  const app = express();

  // Basic middlewares
  app.use(cors());
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Expose-Headers", "Content-Disposition");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Static mounts (ok for serverless: read-only package files)
  app.use("/templates", express.static(path.join(ROOT, "templates")));
  app.use("/assets", express.static(path.join(ROOT, "assets")));
  app.use("/i18n", express.static(path.join(ROOT, "i18n")));

  // Health check
  app.get("/health", (_req, res) => res.json({ ok: true }));

  // API routes (same as standalone server)
  registerPreview(app);
  registerRender(app);
  registerRenderAll(app);
  registerUpload(app);
  registerPresets(app);
  registerDownload(app);

  return app;
}

// Vercel @vercel/node accepts an Express app as the default export
const app = createApp();
export default app;