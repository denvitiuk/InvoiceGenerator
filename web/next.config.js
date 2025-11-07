/** @type {import('next').NextConfig} */
const nextConfig = {
    async rewrites() {
        return [
            // основные ручки
            { source: '/preview',      destination: '/api/preview' },
            { source: '/preview-pdf',  destination: '/api/preview-pdf' },
            { source: '/render',       destination: '/api/render' },
            { source: '/render-all',   destination: '/api/render-all' },
            { source: '/download',     destination: '/api/download' },
            { source: '/upload',       destination: '/api/upload' },

            // статика, которую Express раздаёт (если юзаешь)
            { source: '/templates/:path*', destination: '/api/templates/:path*' },
            { source: '/i18n/:path*',      destination: '/api/i18n/:path*' },
            { source: '/assets/:path*',    destination: '/api/assets/:path*' },
        ];
    },
};
export default nextConfig;