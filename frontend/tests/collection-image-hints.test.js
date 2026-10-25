import { afterEach, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import { collectionImageHints } from '../scripts/collection-image-hints.mjs'

const images = { 'https://img.563118077.xyz/cover.png': { variants:[{url:'/performance-images/abc123-480.webp',width:480,format:'webp'},{url:'/performance-images/abc123-1600.webp',width:1600,format:'webp'}] } }
afterEach(() => vi.unstubAllEnvs())
it('discovers an optimized first cover from HTML with the same responsive sizes as the scene', () => {
  const hint = collectionImageHints('/weekly', [{cover_image:'https://img.563118077.xyz/cover.png'}], images)
  const attributes = {}
  runInNewContext(hint.replace(/^<script[^>]*>|<\/script>$/g, ''), {
    document:{ createElement:() => ({setAttribute:(key,value) => {attributes[key] = value}}), head:{appendChild:vi.fn()} },
  })
  expect(attributes.href).toBe('/performance-images/abc123-1600.webp')
  expect(attributes.imagesrcset).toBe('/performance-images/abc123-480.webp 480w, /performance-images/abc123-1600.webp 1600w')
  expect(attributes.imagesizes).toBe('(max-width: 900px) 82vw, 44vw')
  expect(hint).not.toContain('https://img.')
})
it('does not preload an unknown image or an arbitrary/private route', () => {
  expect(collectionImageHints('/daily', [{cover_image:'https://img.563118077.xyz/new.png'}], images)).toBe('')
  expect(collectionImageHints('/account', [{cover_image:'https://img.563118077.xyz/cover.png'}], images)).toBe('')
})
it('disables hints with the trial flag and rejects non-local derivative mappings', () => {
  const invalid = { 'https://img.563118077.xyz/cover.png':{variants:[{url:'https://other.test/bad.webp',width:1600,format:'webp'}]} }
  expect(collectionImageHints('/daily', [{cover_image:'https://img.563118077.xyz/cover.png'}], invalid)).toBe('')
  vi.stubEnv('VITE_PERFORMANCE_TRIAL', '0')
  expect(collectionImageHints('/daily', [{cover_image:'https://img.563118077.xyz/cover.png'}], images)).toBe('')
})

it('never preloads expired build covers or older covers after a newer empty response', () => {
  const time = Date.parse('2026-10-25T04:00:00Z')
  const script = collectionImageHints('/daily', [{cover_image:'https://img.563118077.xyz/cover.png'}], images, new Date(time).toISOString()).replace(/^<script[^>]*>|<\/script>$/g, '')
  const append = vi.fn()
  const run = (now, saved = null) => runInNewContext(script, { Date:{now:() => now,parse:Date.parse}, sessionStorage:{getItem:() => saved}, document:{createElement:() => ({setAttribute:vi.fn()}),head:{appendChild:append}} })
  run(time + 31 * 60000)
  run(time + 1000, JSON.stringify({schemaVersion:1,route:'/daily',generatedAt:new Date(time+500).toISOString(),items:[]}))
  expect(append).not.toHaveBeenCalled()
  run(time + 1000)
  expect(append).toHaveBeenCalledTimes(1)
})

it('skips technology-layout preloads in paper mode on all four routes', () => {
  for (const route of ['/daily', '/weekly', '/topics', '/series']) {
    const script = collectionImageHints(route, [{cover_image:'https://img.563118077.xyz/cover.png'}], images).replace(/^<script[^>]*>|<\/script>$/g, '')
    const append = vi.fn()
    const run = (getItem) => runInNewContext(script, {
      localStorage:{getItem}, document:{createElement:() => ({setAttribute:vi.fn()}),head:{appendChild:append}},
    })
    run(() => 'paper')
    expect(append).not.toHaveBeenCalled()
    run(() => 'tech')
    expect(append).toHaveBeenCalledTimes(1)
    run(() => { throw new Error('Storage denied') })
    expect(append).toHaveBeenCalledTimes(2)
  }
})
