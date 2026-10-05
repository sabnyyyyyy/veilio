import path from 'node:path';
import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  distDir: '.next-product-e2e',
  turbopack: { root: path.resolve(process.cwd(), '..') },
  images: { remotePatterns: [{ protocol: 'https', hostname: 'images.unsplash.com' }], unoptimized: true },
};
export default nextConfig;