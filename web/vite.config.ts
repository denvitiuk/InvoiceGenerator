import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            "^/(preview|preview-pdf|render|render-all|upload|presets)(/|$)": {
                target: "http://localhost:3001",
                changeOrigin: true
            },
            "^/i18n(/|$)": {
                target: "http://localhost:3001",
                changeOrigin: true
            }
        }
    }
});