/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      // Legacy compatibility: keep old endpoints working by rewriting to Next API routes
      { source: "/preview", destination: "/api/preview" },
      { source: "/preview-pdf", destination: "/api/preview-pdf" },
      { source: "/render", destination: "/api/render" },
      { source: "/render-all", destination: "/api/render-all" },
      { source: "/download", destination: "/api/download" },
      { source: "/upload", destination: "/api/upload" },

      // NOTE:
      // - Static files should be served from `web/public/*` directly (e.g. `/i18n/...`, `/assets/...`, `/presets/...`).
      // - `templates/*` should NOT be exposed via HTTP; they are server-only.
    ];
  },
};

export default nextConfig;