import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'export',
  // Static export means images can't be optimised by Next
  images: { unoptimized: true },
  // Trailing slash for cleaner Cloudflare Pages routing
  trailingSlash: true,
  // The engine package lives as a pnpm workspace sibling. Cloudflare's
  // build environment doesn't pick this up via webpack symlink resolution
  // alone (works locally, fails on CI), so we explicitly tell Next.js to
  // transpile it as part of the web build.
  transpilePackages: ['@prestige-tools/engine'],
  // Local dev workaround: don't follow symlinks so the engine resolves
  // via its dist/ entry. Kept alongside transpilePackages — they handle
  // different surfaces.
  webpack: (config) => {
    config.resolve.symlinks = false;
    return config;
  },
};

export default config;