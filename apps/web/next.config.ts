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
  webpack: (config) => {
    // The engine's source TS files use modern TS import style
    // (`from './types.js'`) even though the files are `.ts`. This is what
    // TS's "bundler" moduleResolution allows. Webpack doesn't honour that
    // by default, so we add an extension alias: when a .js import is seen,
    // try .ts and .tsx first before falling back to actual .js.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    // Don't follow symlinks so workspace packages resolve via their
    // package.json entry rather than walking into source files.
    config.resolve.symlinks = false;
    return config;
  },
};

export default config;