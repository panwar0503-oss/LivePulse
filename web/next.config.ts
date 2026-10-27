import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // shared/ ships TypeScript source (workspace package), so Next must compile it.
  transpilePackages: ['@livepulse/shared'],
  webpack: (config) => {
    // shared/ imports siblings as './x.js' (NodeNext style); resolve those to the .ts source.
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, '.js': ['.ts', '.tsx', '.js'] }
    return config
  },
  // Old bookmarks and shared links keep working after the route rename. /join is unchanged.
  async redirects() {
    return [
      { source: '/create', destination: '/host', permanent: true },
      { source: '/presenter/:path*', destination: '/host/:path*', permanent: true },
      { source: '/session/:roomCode', destination: '/room/:roomCode', permanent: true },
    ]
  },
}

export default nextConfig
