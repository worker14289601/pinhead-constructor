/** @type {import('next').NextConfig} */
const nextConfig = {
  // Как в pnhd-studio: standalone-сборка под Docker.
  output: 'standalone',
  webpack: (config) => {
    // Konva тянет node-пакет canvas на сервере — отключаем, как в pnhd-studio.
    config.externals = [...config.externals, { canvas: 'canvas' }];
    return config;
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.pnhd.ru', pathname: '/**' },
      { protocol: 'https', hostname: 'api.pnhd.ru', pathname: '/**' },
    ],
  },
};

export default nextConfig;
