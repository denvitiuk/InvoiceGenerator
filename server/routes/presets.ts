

import type { Express, Request, Response } from "express";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { InvoiceData } from "../types/invoice.js";

const PRESETS_DIR = path.join(process.cwd(), "data", "presets");
const NAME_RE = /^[a-z0-9._-]{1,80}$/i; // safe file names

async function ensureDir() {
  await fs.mkdir(PRESETS_DIR, { recursive: true });
}

function toFile(name: string) {
  const base = name.endsWith(".json") ? name : `${name}.json`;
  return path.join(PRESETS_DIR, base);
}

async function readJsonSafe<T = unknown>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(file: string, obj: any) {
  const tmp = `${file}.tmp-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

function badName(res: Response) {
  res.status(400).json({ error: "Invalid preset name. Allowed: [a-z0-9._-], length 1..80" });
}

function minimalValidateInvoice(data: any): data is InvoiceData {
  if (!data || typeof data !== "object") return false;
  if (!data.currency || !data.issueDateISO) return false;
  if (!data.company || typeof data.company.name !== "string") return false;
  if (!data.client || typeof data.client.name !== "string") return false;
  if (!Array.isArray(data.items)) return false;
  return true;
}

export default function registerPresets(app: Express) {
  // List presets
  app.get("/presets", async (_req: Request, res: Response) => {
    try {
      await ensureDir();
      const files = await fs.readdir(PRESETS_DIR);
      const list = await Promise.all(
        files
          .filter((f) => f.endsWith(".json"))
          .map(async (f) => {
            const st = await fs.stat(path.join(PRESETS_DIR, f));
            return { name: f.replace(/\.json$/i, ""), size: st.size, mtime: st.mtimeMs };
          })
      );
      res.json({ ok: true, presets: list.sort((a, b) => b.mtime - a.mtime) });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to list presets" });
    }
  });

  // Get preset by name
  app.get("/presets/:name", async (req: Request, res: Response) => {
    const name = String(req.params.name || "");
    if (!NAME_RE.test(name)) return badName(res);
    try {
      await ensureDir();
      const file = toFile(name);
      const json = await readJsonSafe(file);
      if (!json) return res.status(404).json({ error: "Preset not found" });
      res.json({ ok: true, name, data: json });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to read preset" });
    }
  });

  // Create or update preset
  app.post("/presets", async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as any;
      const name = String(body.name || "");
      const data = body.data as InvoiceData;
      const overwrite = Boolean(body.overwrite ?? true);

      if (!NAME_RE.test(name)) return badName(res);
      if (!minimalValidateInvoice(data)) return res.status(400).json({ error: "Invalid invoice data" });

      await ensureDir();
      const file = toFile(name);

      if (!overwrite) {
        try { await fs.access(file); return res.status(409).json({ error: "Preset already exists" }); } catch {}
      }

      await writeJsonAtomic(file, data);
      res.json({ ok: true, name });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to save preset" });
    }
  });

  // Update existing preset by name (PUT)
  app.put("/presets/:name", async (req: Request, res: Response) => {
    const name = String(req.params.name || "");
    if (!NAME_RE.test(name)) return badName(res);
    try {
      const body = (req.body ?? {}) as any;
      const data = body.data as InvoiceData;
      if (!minimalValidateInvoice(data)) return res.status(400).json({ error: "Invalid invoice data" });
      await ensureDir();
      const file = toFile(name);
      await writeJsonAtomic(file, data);
      res.json({ ok: true, name });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to update preset" });
    }
  });

  // Rename preset
  app.post("/presets/:name/rename", async (req: Request, res: Response) => {
    const name = String(req.params.name || "");
    const newName = String((req.body?.newName as string) || "");
    if (!NAME_RE.test(name) || !NAME_RE.test(newName)) return badName(res);
    try {
      await ensureDir();
      const src = toFile(name);
      const dst = toFile(newName);
      await fs.rename(src, dst);
      res.json({ ok: true, name: newName, oldName: name });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to rename preset" });
    }
  });

  // Delete preset
  app.delete("/presets/:name", async (req: Request, res: Response) => {
    const name = String(req.params.name || "");
    if (!NAME_RE.test(name)) return badName(res);
    try {
      await ensureDir();
      const file = toFile(name);
      await fs.unlink(file);
      res.json({ ok: true, name });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Failed to delete preset" });
    }
  });
}