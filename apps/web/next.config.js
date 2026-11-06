/** @type {import('next').NextConfig} */
module.exports = {
  outputFileTracingRoot: require('node:path').resolve(__dirname, '../..'),
  transpilePackages: ['@otog/ui'],
  async rewrites() {
    const apiHost = process.env.API_HOST_SSR || 'http://localhost:8000'

    return [
      {
        source: '/backend/:path*',
        destination: `${apiHost}/:path*`,
      },
      {
        source: '/socket.io/:path*',
        destination: `${apiHost}/socket.io/:path*`,
      },
    ]
  },
  experimental: {
    cpus: 1,
    esmExternals: 'loose',
    optimizePackageImports: ['@phosphor-icons/react'],
  },
  output: 'standalone',
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; base-uri 'self'" },
    ] }]
  },
}
