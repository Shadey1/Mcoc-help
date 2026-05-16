import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'export',
  // Static export means images can't be optimised by Next
  images: { unoptimized: true },
  // Trailing slash for cleaner Cloudflare Pages routing
  trailingSlash: true,
  // pnpm workspace fix: don't follow symlinks in node_modules so the engine
  // package is resolved via its dist entry rather than source files.
  webpack: (config) => {
    config.resolve.symlinks = false;
    return config;
  },
};

export default config;
