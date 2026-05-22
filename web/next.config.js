/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    outputFileTracingExcludes: {
      "/api/render": [
        "./node_modules/electron/**/*",
        "./node_modules/electron-builder/**/*",
        "./node_modules/app-builder-lib/**/*",
        "./node_modules/builder-util/**/*",
        "./node_modules/builder-util-runtime/**/*",
        "./node_modules/dmg-builder/**/*",
        "./node_modules/winreg/**/*",
        "./electron/**/*",
        "./dist/**/*",
        "./build/**/*",
        "./scripts/**/*"
      ],
      "/api/renderAll": [
        "./node_modules/electron/**/*",
        "./node_modules/electron-builder/**/*",
        "./node_modules/app-builder-lib/**/*",
        "./node_modules/builder-util/**/*",
        "./node_modules/builder-util-runtime/**/*",
        "./node_modules/dmg-builder/**/*",
        "./node_modules/winreg/**/*",
        "./electron/**/*",
        "./dist/**/*",
        "./build/**/*",
        "./scripts/**/*"
      ]
    }
  },

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