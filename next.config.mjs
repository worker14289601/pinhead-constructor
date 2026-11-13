/** @type {import('next').NextConfig} */
// STATIC_EXPORT=1 — статический стенд (например, GitHub Pages): без серверной части, сайт в подпапке NEXT_PUBLIC_BASE_PATH.
const staticExport = process.env.STATIC_EXPORT === '1';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig = {
  // Как в pnhd-studio: standalone-сборка под Docker.
  output: staticExport ? 'export' : 'standalone',
  ...(staticExport ? { basePath, trailingSlash: true } : {}),
  webpack: (config) => {
    // Konva тянет node-пакет canvas на сервере — отключаем, как в pnhd-studio.
    config.externals = [...config.externals, { canvas: 'canvas' }];
    return config;
  },
  images: {
    unoptimized: staticExport,
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.pnhd.ru', pathname: '/**' },
      { protocol: 'https', hostname: 'api.pnhd.ru', pathname: '/**' },
    ],
  },
};

export default nextConfig;
