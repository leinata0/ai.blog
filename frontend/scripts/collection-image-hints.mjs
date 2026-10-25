import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(resolve(scriptDir, '../src/data/image-variants.json'), 'utf8'))
const sizes = {
  '/daily': '100vw',
  '/weekly': '(max-width: 900px) 82vw, 44vw',
  '/topics': '100vw',
  '/series': '(max-width: 760px) 42vw, 24vw',
}
const escape = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function collectionImageHints(route, items, images = manifest.images, generatedAt) {
  if (process.env.VITE_PERFORMANCE_TRIAL === '0' || !sizes[route]) return ''
  const source = items?.[0]?.cover_image
  if (typeof source !== 'string' || !source.trim()) return ''
  let image
  try { image = images[new URL(source.trim(), 'https://www.563118077.xyz').href] } catch { return '' }
  const variants = image?.variants?.filter(v => v.format === 'webp' && /^\/performance-images\/[a-f0-9]+-\d+\.webp$/.test(v.url) && Number.isFinite(v.width) && v.width > 0)
  if (!variants?.length) return ''
  const first = variants.find(v => v.width >= 1600) || variants.at(-1)
  const srcSet = variants.map(v => `${v.url} ${v.width}w`).join(', ')
  const attributes = { rel:'preload', as:'image', href:first.url, imagesrcset:srcSet, imagesizes:sizes[route], fetchpriority:'high', referrerpolicy:'no-referrer' }
  if (!generatedAt) return `<link ${Object.entries(attributes).map(([key,value]) => `${key}="${escape(value)}"`).join(' ')}>`
  const timestamp = Date.parse(generatedAt)
  if (!Number.isFinite(timestamp)) return ''
  // A saved HTML page can outlive its data snapshot. Do not preload a withdrawn
  // build cover after expiry or after this tab has observed newer runtime data.
  const attrs = JSON.stringify(attributes).replace(/</g, '\\u003c')
  const key = JSON.stringify(`blog.collection-trial:${route}`)
  const path = JSON.stringify(route)
  return `<script data-collection-image-hint>(function(){var t=${timestamp},n=Date.now();if(n-t>1800000||t-n>60000)return;try{var s=JSON.parse(sessionStorage.getItem(${key}));if(s&&s.schemaVersion===1&&s.route===${path}&&Date.parse(s.generatedAt)>=t)return}catch(e){}var l=document.createElement('link'),a=${attrs};Object.keys(a).forEach(function(k){l.setAttribute(k,a[k])});document.head.appendChild(l)})();</script>`
}
