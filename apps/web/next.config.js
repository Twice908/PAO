const { config } = require('dotenv')
const { resolve } = require('path')

// Load root .env so server-side code (API routes, Server Components) can access all vars
config({ path: resolve(__dirname, '../../.env') })

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@pulse/types', '@pulse/db'],

  // The rendered API reference is a static file generated into
  // public/docs/api/index.html by scripts/build-api-docs.mjs. Next serves
  // public/ verbatim and does not resolve an extensionless path to index.html,
  // so /docs/api would 404 without this rewrite.
  async rewrites() {
    return [{ source: '/docs/api', destination: '/docs/api/index.html' }]
  },
}

module.exports = nextConfig
