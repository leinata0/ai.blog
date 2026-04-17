const backendOrigin = String(process.env.VERCEL_BACKEND_ORIGIN || process.env.VITE_API_BASE || '')
  .trim()
  .replace(/\/$/, '')

const backendRewrites = backendOrigin
  ? [
      { source: '/api/health', destination: `${backendOrigin}/api/health` },
      { source: '/feed.xml', destination: `${backendOrigin}/feed.xml` },
      { source: '/sitemap.xml', destination: `${backendOrigin}/sitemap.xml` },
      { source: '/api/(.*)', destination: `${backendOrigin}/api/$1` },
      { source: '/uploads/(.*)', destination: `${backendOrigin}/uploads/$1` },
      { source: '/proxy-image', destination: `${backendOrigin}/proxy-image` },
    ]
  : []

export default {
  framework: 'vite',
  buildCommand: 'npm run build',
  outputDirectory: 'dist',
  rewrites: [
    ...backendRewrites,
    { source: '/(.*)', destination: '/index.html' },
  ],
  headers: [
    {
      source: '/assets/(.*)',
      headers: [
        { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
      ],
    },
  ],
}
