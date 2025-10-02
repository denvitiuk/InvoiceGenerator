// @ts-nocheck
import express from "express";
import * as path from "node:path";

// Роуты
import registerPreview from "./routes/preview.js";
import registerRender from "./routes/render.js";
import registerRenderAll from "./routes/renderAll.js";
import registerUpload from "./routes/upload.js";
import registerPresets from "./routes/presets.js";
import registerPreviewPdf from "./routes/previewPdf.js";

// Аккуратное закрытие Playwright при остановке сервера
import { closePdfBrowser } from "./lib/pdf.js";

const app = express();

// JSON body
app.use(express.json({ limit: "10mb" }));

// Простой CORS (чтобы не тянуть зависимость cors)
app.use((req: any, res: any, next: any) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});

const ROOT = process.cwd();

// Статика (для превью/картинок/словари UI)
app.use("/templates", express.static(path.join(ROOT, "templates")));
app.use("/assets", express.static(path.join(ROOT, "assets")));
app.use("/i18n", express.static(path.join(ROOT, "i18n")));

// Регистрация маршрутов
registerPreview(app);     // POST /preview -> HTML
registerPreviewPdf(app);  // POST /preview-pdf -> inline PDF preview
registerRender(app);      // POST /render  -> PDF
registerRenderAll(app);   // POST /render-all -> ZIP с PDF на нескольких языках
registerUpload(app);      // POST /upload -> загрузка логотипов/картинок
registerPresets(app);     // GET/POST/PUT/DELETE /presets -> пресеты

// Healthcheck
app.get("/health", (_req: any, res: any) => res.json({ ok: true }));

const PORT = Number(process.env.PORT) || 3001;
const server = app.listen(PORT, () => {
    console.log(`Invoice server running on http://localhost:${PORT}`);
});

// Грейсфул-шатдаун
async function shutdown(signal: string) {
    console.log(`\n${signal} received. Closing server...`);
    server.close(async () => {
        try { await closePdfBrowser(); } catch {}
        process.exit(0);
    });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));