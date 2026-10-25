import {
  COLLECTION_ROUTES,
  createCollectionSnapshot,
  serializeCollectionSnapshot,
} from '../src/utils/publicCollectionSnapshot.js'

/** Reuse the public lists already fetched by the full-site build for SPA navigation. */
export function collectionBootstrapBundleScript(collections, generatedAt = new Date().toISOString()) {
  if (String(process.env.VITE_PERFORMANCE_TRIAL ?? '1') === '0') return ''
  const entries = COLLECTION_ROUTES.map((route) => {
    const snapshot = createCollectionSnapshot(route, Array.isArray(collections?.[route]) ? collections[route] : [], generatedAt)
    let serialized = serializeCollectionSnapshot(snapshot)
    // A list of maximum-length Unicode fields can exceed the per-route byte budget.
    // Keep the newest summaries that fit instead of dropping the entire route.
    while (!serialized && snapshot.items.length) {
      snapshot.items.pop()
      serialized = serializeCollectionSnapshot(snapshot)
    }
    if (!serialized) throw new Error(`[prerender] collection metadata exceeds the snapshot budget: ${route}`)
    return `${JSON.stringify(route)}:${serialized}`
  })
  // serializeCollectionSnapshot already escapes HTML delimiters and JS separators.
  // Four separately bounded snapshots keep this at 512 KiB plus the fixed wrapper.
  return `<script>window.__BLOG_COLLECTION_BOOTSTRAPS__={${entries.join(',')}};</script>`
}

export function injectCollectionBootstrapBundle(template, script) {
  if (!script) return template
  // Put data ahead of module discovery/execution, including in Vite-built templates
  // where the module lives in <head>. A callback keeps $& / $' / $` payloads literal.
  const moduleStart = /<script\b(?=[^>]*\btype\s*=\s*["']module["'])[^>]*>/i
  if (moduleStart.test(template)) return template.replace(moduleStart, (marker) => `${script}\n${marker}`)
  if (!template.includes('</head>')) throw new Error('[prerender] collection bundle requires a module script or </head> marker')
  return template.replace('</head>', () => `${script}\n</head>`)
}
