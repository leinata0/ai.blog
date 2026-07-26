import assert from 'node:assert/strict'
import test from 'node:test'

// The repair script no longer hard-codes a CDN literal; trusted hosts come from
// configuration so a renamed CDN cannot silently make localized images look
// third-party again. Set this before the first call, not before the import.
process.env.TRUSTED_IMAGE_HOSTS = 'img.563118077.xyz'

const {
  classifyDownloadFailure,
  extractExternalMarkdownImages,
  mapWithConcurrency,
  parseArgs,
  pruneImageSourcesSection,
  repairPublishedPostImages,
  resolveTrustedImageHosts,
  rewriteExternalMarkdownImages,
  splitMarkdownCodeRegions,
  stripThirdPartyMarkdownImages,
} = await import('../repair-post-media.mjs')

const silentLogger = { log() {}, warn() {} }
const noSleep = async () => {}

function permanentError(message, status = 404) {
  const error = new Error(message)
  error.status = status
  error.permanentFailure = true
  return error
}

function pngImage() {
  return { buffer: Buffer.alloc(96), contentType: 'image/png', extension: '.png' }
}

test('stripThirdPartyMarkdownImages removes external links and preserves localized media', () => {
  const result = stripThirdPartyMarkdownImages(`
## Section

![broken](https://third-party.example.com/image.png)

![localized](https://img.563118077.xyz/image.png)
`)

  assert.equal(result.removed, 1)
  assert.doesNotMatch(result.content, /third-party/)
  assert.match(result.content, /img\.563118077\.xyz/)
})

test('resolveTrustedImageHosts merges the API origin with configured CDN hosts', () => {
  const hosts = resolveTrustedImageHosts({
    env: { TRUSTED_IMAGE_HOSTS: 'cdn.one.example, cdn.two.example', R2_PUBLIC_BASE_URL: 'https://r2.example.com/bucket' },
    blogApiBase: 'https://api.example.com',
  })

  assert.deepEqual([...hosts].sort(), ['api.example.com', 'cdn.one.example', 'cdn.two.example', 'r2.example.com'])
})

test('batch mode is dry-run by default and requires explicit apply', () => {
  assert.deepEqual(
    { all: parseArgs(['--all']).all, apply: parseArgs(['--all']).apply, dryRun: parseArgs(['--all']).dryRun },
    { all: true, apply: false, dryRun: true },
  )
  assert.equal(parseArgs(['--all', '--apply']).dryRun, false)
  assert.equal(parseArgs(['--all', '--dry-run']).dryRun, true)
  assert.throws(() => parseArgs(['--all', '--apply', '--dry-run']), /cannot be used together/)
})

test('extract and rewrite only third-party Markdown images', () => {
  const content = `
![one](https://cdn.example.com/a.png "caption")
![same](https://cdn.example.com/a.png)
![owned](https://img.563118077.xyz/already.webp)
`
  assert.deepEqual(extractExternalMarkdownImages(content), [
    { alt: 'one', url: 'https://cdn.example.com/a.png' },
  ])

  const rewritten = rewriteExternalMarkdownImages(content, new Map([
    ['https://cdn.example.com/a.png', { status: 'localized', url: 'https://img.563118077.xyz/new.webp' }],
  ]))
  assert.equal(rewritten.localized, 2)
  assert.equal(rewritten.removed, 0)
  assert.doesNotMatch(rewritten.content, /cdn\.example\.com/)
  assert.match(rewritten.content, /already\.webp/)
})

test('splitMarkdownCodeRegions round-trips and marks fenced blocks', () => {
  const content = 'intro\n\n```js\nconst a = 1\n\n\n\nconst b = 2\n```\n\nouttro\n'
  const segments = splitMarkdownCodeRegions(content)

  assert.equal(segments.map((segment) => segment.text).join(''), content)
  assert.equal(segments.filter((segment) => segment.code).length, 1)
  assert.match(segments.find((segment) => segment.code).text, /const a = 1/)
})

test('fenced code blocks and inline code are never rewritten or reflowed', () => {
  const content = [
    '## Guide',
    '',
    '写法示例：`![demo](https://cdn.example.com/inline.png)`',
    '',
    '```markdown',
    '![demo](https://cdn.example.com/fenced.png)',
    '',
    '',
    '',
    'still inside the fence',
    '```',
    '',
    '![real](https://cdn.example.com/real.png)',
    '',
    'tail',
    '',
  ].join('\n')

  assert.deepEqual(extractExternalMarkdownImages(content), [
    { alt: 'real', url: 'https://cdn.example.com/real.png' },
  ])

  const rewritten = rewriteExternalMarkdownImages(content, new Map([
    ['https://cdn.example.com/real.png', { status: 'localized', url: 'https://img.563118077.xyz/real.png' }],
  ]))

  assert.match(rewritten.content, /```markdown\n!\[demo\]\(https:\/\/cdn\.example\.com\/fenced\.png\)\n\n\n\nstill inside the fence\n```/)
  assert.match(rewritten.content, /`!\[demo\]\(https:\/\/cdn\.example\.com\/inline\.png\)`/)
  assert.match(rewritten.content, /!\[real\]\(https:\/\/img\.563118077\.xyz\/real\.png\)/)
})

test('a post whose only Markdown image lives in a code block is reported as unchanged', () => {
  const content = 'intro\n\n```md\n![demo](https://cdn.example.com/demo.png)\n\n\n\nend\n```\n\ntail\n'
  const rewritten = rewriteExternalMarkdownImages(content, new Map())

  assert.equal(rewritten.changed, false)
  assert.equal(rewritten.content, content)
})

test('removal collapses only the gap it created, not the rest of the document', () => {
  const content = 'A\n\n![gone](https://cdn.example.com/gone.png)\n\nB\n\n\n\nC\n'
  const rewritten = rewriteExternalMarkdownImages(content, new Map([
    ['https://cdn.example.com/gone.png', { status: 'remove', reason: 'HTTP 404' }],
  ]))

  assert.equal(rewritten.removed, 1)
  assert.equal(rewritten.content, 'A\n\nB\n\n\n\nC\n')
})

test('linked images are rewritten as a unit instead of leaving an empty link', () => {
  const content = 'A\n\n[![badge](https://cdn.example.com/badge.png)](https://vendor.example/product)\n\nB\n'

  const localized = rewriteExternalMarkdownImages(content, new Map([
    ['https://cdn.example.com/badge.png', { status: 'localized', url: 'https://img.563118077.xyz/badge.png' }],
  ]))
  assert.equal(localized.localized, 1)
  assert.match(localized.content, /\[!\[badge\]\(https:\/\/img\.563118077\.xyz\/badge\.png\)\]\(https:\/\/vendor\.example\/product\)/)

  const removed = rewriteExternalMarkdownImages(content, new Map([
    ['https://cdn.example.com/badge.png', { status: 'remove', reason: 'HTTP 410' }],
  ]))
  assert.equal(removed.removed, 1)
  assert.doesNotMatch(removed.content, /\[\]\(/)
  assert.doesNotMatch(removed.content, /vendor\.example/)
})

test('pruneImageSourcesSection drops credits for sections that lost their image', () => {
  const content = [
    '## 现状',
    '',
    '![still here](https://img.563118077.xyz/a.png)',
    '',
    '## 影响',
    '',
    '正文没有图了。',
    '',
    '## 图片来源',
    '',
    '- 现状: [Vendor](https://vendor.example/a)',
    '- 影响: [Other](https://other.example/b)',
    '',
    '## 参考来源',
    '',
    '- [x](https://x.example/)',
    '',
  ].join('\n')

  const pruned = pruneImageSourcesSection(content)

  assert.match(pruned, /- 现状: \[Vendor\]/)
  assert.doesNotMatch(pruned, /- 影响: \[Other\]/)
  assert.match(pruned, /## 参考来源/)
  assert.equal(pruneImageSourcesSection(pruned), pruned, 'pruning is idempotent')
})

test('removing the last inline image leaves an explicit empty image-source list', () => {
  const content = [
    '## 影响',
    '',
    '![gone](https://cdn.example.com/gone.png)',
    '',
    '## 图片来源',
    '',
    '- 影响: [Vendor](https://vendor.example/a)',
    '',
  ].join('\n')

  const rewritten = rewriteExternalMarkdownImages(content, new Map([
    ['https://cdn.example.com/gone.png', { status: 'remove', reason: 'HTTP 404' }],
  ]))

  assert.doesNotMatch(rewritten.content, /vendor\.example/)
  assert.match(rewritten.content, /- 无正文插图/)
})

test('mapWithConcurrency preserves order and respects its worker limit', async () => {
  let active = 0
  let peak = 0
  const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active -= 1
    return value * 2
  })
  assert.deepEqual(results, [2, 4, 6, 8])
  assert.equal(peak, 2)
})

test('classifyDownloadFailure only calls 404/410 and proven non-images permanent', () => {
  assert.equal(classifyDownloadFailure(permanentError('gone', 404)), 'permanent')
  assert.equal(classifyDownloadFailure(new Error('Image download failed: HTTP 404')), 'permanent')
  assert.equal(classifyDownloadFailure(new Error('Image download failed: HTTP 410')), 'permanent')
  assert.equal(classifyDownloadFailure(new Error('Image download failed: HTTP 403')), 'transient')
  assert.equal(classifyDownloadFailure(new Error('Image download failed: HTTP 429')), 'transient')
  assert.equal(classifyDownloadFailure(new Error('Image download failed: HTTP 503')), 'transient')
  assert.equal(classifyDownloadFailure(new Error('fetch failed: ENOTFOUND')), 'transient')
  assert.equal(classifyDownloadFailure(new Error('The operation was aborted due to timeout')), 'transient')
})

test('batch repair deduplicates downloads and uploads, removes gone images, and isolates posts', async () => {
  const contents = new Map([
    [1, 'A\n\n![good](https://cdn.example.com/good.png)\n\n![again](https://cdn.example.com/good.png)\n\n![bad](https://cdn.example.com/bad.png)'],
    [2, 'B\n\n![shared](https://cdn.example.com/good.png)'],
  ])
  const requests = []
  const fetchImpl = async (rawUrl, options = {}) => {
    const url = new URL(rawUrl)
    requests.push({ url: url.toString(), method: options.method || 'GET', body: options.body })
    if (url.pathname === '/api/admin/posts') {
      const page = Number(url.searchParams.get('page'))
      return Response.json({
        items: page === 1 ? [{ id: 1, slug: 'one' }] : [{ id: 2, slug: 'two' }],
        total: 2,
      })
    }
    const match = url.pathname.match(/^\/api\/admin\/posts\/(\d+)$/)
    if (match && !options.method) {
      const id = Number(match[1])
      return Response.json({ id, slug: id === 1 ? 'one' : 'two', content_md: contents.get(id) })
    }
    if (match && options.method === 'PUT') return Response.json({ id: Number(match[1]) })
    throw new Error(`Unexpected request: ${url}`)
  }
  const downloads = []
  const uploads = []
  const audit = await repairPublishedPostImages({
    token: 'token',
    apply: true,
    concurrency: 2,
    pageSize: 1,
    fetchImpl,
    sleepImpl: noSleep,
    downloadImage: async (url) => {
      downloads.push(url)
      // 404 is the only kind of failure that may delete a published image.
      if (url.endsWith('/bad.png')) throw permanentError('Image download failed: HTTP 404', 404)
      return pngImage()
    },
    uploadImage: async ({ image }) => {
      uploads.push(image)
      return 'https://img.563118077.xyz/localized.png'
    },
    logger: silentLogger,
  })

  assert.deepEqual([...new Set(downloads)].sort(), [
    'https://cdn.example.com/bad.png',
    'https://cdn.example.com/good.png',
  ])
  assert.equal(uploads.length, 1)
  assert.equal(audit.posts_scanned, 2)
  assert.equal(audit.posts_changed, 2)
  assert.equal(audit.unique_localized, 1)
  assert.equal(audit.unique_removed, 1)
  assert.deepEqual(audit.trusted_image_hosts.includes('img.563118077.xyz'), true)
  const updates = requests.filter((request) => request.method === 'PUT')
  assert.equal(updates.length, 2)
  assert.doesNotMatch(JSON.parse(updates[0].body).content_md, /bad\.png/)
  assert.doesNotMatch(JSON.parse(updates[0].body).content_md, /cdn\.example\.com/)
})

test('batch updates suppress notifications so archive repairs never mail subscribers', async () => {
  const bodies = []
  await repairPublishedPostImages({
    token: 'token',
    apply: true,
    sleepImpl: noSleep,
    fetchImpl: async (rawUrl, options = {}) => {
      const url = new URL(rawUrl)
      if (url.pathname === '/api/admin/posts') {
        return Response.json({ items: [{ id: 7, slug: 'seven' }], total: 1 })
      }
      if (options.method === 'PUT') {
        bodies.push(JSON.parse(options.body))
        return Response.json({ id: 7 })
      }
      return Response.json({ id: 7, slug: 'seven', content_md: '![x](https://cdn.example.com/x.png)' })
    },
    downloadImage: async () => pngImage(),
    uploadImage: async () => 'https://img.563118077.xyz/x.png',
    logger: silentLogger,
  })

  assert.equal(bodies.length, 1)
  assert.equal(bodies[0].suppress_notifications, true)
  assert.ok('content_md' in bodies[0])
})

test('a transient download failure retries and then keeps the published image', async () => {
  const attempts = []
  const delays = []
  const audit = await repairPublishedPostImages({
    token: 'token',
    apply: true,
    retryBaseDelayMs: 10,
    sleepImpl: async (ms) => { delays.push(ms) },
    fetchImpl: async (rawUrl, options = {}) => {
      const url = new URL(rawUrl)
      if (url.pathname === '/api/admin/posts') {
        return Response.json({ items: [{ id: 1, slug: 'one' }], total: 1 })
      }
      if (options.method === 'PUT') throw new Error('must not update')
      return Response.json({ id: 1, slug: 'one', content_md: 'A\n\n![x](https://cdn.example.com/x.png)\n' })
    },
    downloadImage: async (url) => {
      attempts.push(url)
      throw new Error('Image download failed: HTTP 429')
    },
    uploadImage: async () => 'https://img.563118077.xyz/x.png',
    logger: silentLogger,
  })

  assert.equal(attempts.length, 3, 'transient failures are retried')
  assert.deepEqual(delays, [10, 20], 'retries back off exponentially')
  assert.equal(audit.unique_removed, 0)
  assert.equal(audit.unique_download_failed, 1)
  assert.equal(audit.posts_changed, 0)
  assert.equal(audit.image_failures[0].stage, 'download')
  assert.match(audit.image_failures[0].error, /HTTP 429/)
})

test('a permanent 404 is not retried and the image is removed', async () => {
  const attempts = []
  const audit = await repairPublishedPostImages({
    token: 'token',
    apply: true,
    sleepImpl: noSleep,
    fetchImpl: async (rawUrl, options = {}) => {
      const url = new URL(rawUrl)
      if (url.pathname === '/api/admin/posts') {
        return Response.json({ items: [{ id: 1, slug: 'one' }], total: 1 })
      }
      if (options.method === 'PUT') return Response.json({ id: 1 })
      return Response.json({ id: 1, slug: 'one', content_md: 'A\n\n![x](https://cdn.example.com/x.png)\n' })
    },
    downloadImage: async (url) => {
      attempts.push(url)
      throw permanentError('Image download failed: HTTP 404', 404)
    },
    uploadImage: async () => 'https://img.563118077.xyz/x.png',
    logger: silentLogger,
  })

  assert.equal(attempts.length, 1)
  assert.equal(audit.unique_removed, 1)
  assert.equal(audit.posts_changed, 1)
})

test('removed_urls keep the full original address including signed query parameters', async () => {
  const signedUrl = 'https://cdn.example.com/a.png?sig=abc123&expires=99#frag'
  const audit = await repairPublishedPostImages({
    token: 'token',
    apply: false,
    sleepImpl: noSleep,
    fetchImpl: async (rawUrl) => {
      const url = new URL(rawUrl)
      if (url.pathname === '/api/admin/posts') {
        return Response.json({ items: [{ id: 1, slug: 'one' }], total: 1 })
      }
      return Response.json({ id: 1, slug: 'one', content_md: `![x](${signedUrl})` })
    },
    downloadImage: async () => { throw permanentError('Image download failed: HTTP 410', 410) },
    logger: silentLogger,
  })

  assert.equal(audit.removed_urls.length, 1)
  assert.equal(audit.removed_urls[0].url, signedUrl)
})

test('audit URLs still strip embedded credentials', async () => {
  const audit = await repairPublishedPostImages({
    token: 'token',
    apply: false,
    sleepImpl: noSleep,
    fetchImpl: async (rawUrl) => {
      const url = new URL(rawUrl)
      if (url.pathname === '/api/admin/posts') {
        return Response.json({ items: [{ id: 1, slug: 'one' }], total: 1 })
      }
      return Response.json({ id: 1, slug: 'one', content_md: '![x](https://user:secret@cdn.example.com/a.png)' })
    },
    downloadImage: async () => { throw permanentError('Image download failed: HTTP 404', 404) },
    logger: silentLogger,
  })

  assert.equal(audit.removed_urls[0].url, 'https://cdn.example.com/a.png')
})

test('dry-run verifies images without uploading or updating posts', async () => {
  let uploads = 0
  let updates = 0
  const audit = await repairPublishedPostImages({
    token: 'token',
    apply: false,
    sleepImpl: noSleep,
    fetchImpl: async (rawUrl, options = {}) => {
      const url = new URL(rawUrl)
      if (url.pathname === '/api/admin/posts') {
        return Response.json({ items: [{ id: 1, slug: 'one' }], total: 1 })
      }
      if (options.method === 'PUT') {
        updates += 1
        return Response.json({ id: 1 })
      }
      return Response.json({ id: 1, slug: 'one', content_md: '![x](https://cdn.example.com/x.png)' })
    },
    downloadImage: async () => pngImage(),
    uploadImage: async () => {
      uploads += 1
      return 'https://img.563118077.xyz/x.png'
    },
    logger: silentLogger,
  })
  assert.equal(audit.mode, 'dry-run')
  assert.equal(audit.posts_would_change, 1)
  assert.equal(audit.unique_verified, 1)
  assert.equal(uploads, 0)
  assert.equal(updates, 0)
})

test('dry-run does not count posts whose images all failed transiently', async () => {
  const audit = await repairPublishedPostImages({
    token: 'token',
    apply: false,
    sleepImpl: noSleep,
    fetchImpl: async (rawUrl) => {
      const url = new URL(rawUrl)
      if (url.pathname === '/api/admin/posts') {
        return Response.json({ items: [{ id: 1, slug: 'one' }], total: 1 })
      }
      return Response.json({ id: 1, slug: 'one', content_md: '![x](https://cdn.example.com/x.png)' })
    },
    downloadImage: async () => { throw new Error('Image download failed: HTTP 503') },
    logger: silentLogger,
  })

  assert.equal(audit.posts_with_external_images, 1)
  assert.equal(audit.posts_would_change, 0)
  assert.equal(audit.unique_download_failed, 1)
})

test('batch apply keeps valid external images when upload fails', async () => {
  let updates = 0
  const audit = await repairPublishedPostImages({
    token: 'token',
    apply: true,
    sleepImpl: noSleep,
    fetchImpl: async (rawUrl, options = {}) => {
      const url = new URL(rawUrl)
      if (url.pathname === '/api/admin/posts') {
        return Response.json({ items: [{ id: 1, slug: 'one' }], total: 1 })
      }
      if (options.method === 'PUT') {
        updates += 1
        return Response.json({ id: 1 })
      }
      return Response.json({ id: 1, slug: 'one', content_md: '![x](https://cdn.example.com/x.png)' })
    },
    downloadImage: async () => pngImage(),
    uploadImage: async () => { throw new Error('storage temporarily unavailable') },
    logger: silentLogger,
  })
  assert.equal(audit.unique_upload_failed, 1)
  assert.equal(audit.unique_removed, 0)
  assert.equal(audit.posts_changed, 0)
  assert.equal(updates, 0)
})

test('batch apply continues updating other posts after one update fails', async () => {
  const updatedIds = []
  const audit = await repairPublishedPostImages({
    token: 'token',
    apply: true,
    sleepImpl: noSleep,
    fetchImpl: async (rawUrl, options = {}) => {
      const url = new URL(rawUrl)
      if (url.pathname === '/api/admin/posts') {
        return Response.json({ items: [{ id: 1, slug: 'one' }, { id: 2, slug: 'two' }], total: 2 })
      }
      const id = Number(url.pathname.split('/').at(-1))
      if (options.method === 'PUT') {
        updatedIds.push(id)
        if (id === 1) return new Response('write failed', { status: 503 })
        return Response.json({ id })
      }
      return Response.json({ id, slug: id === 1 ? 'one' : 'two', content_md: `![x](https://cdn.example.com/${id}.png)` })
    },
    downloadImage: async () => pngImage(),
    uploadImage: async ({ image }) => `https://img.563118077.xyz/${image.buffer.length}.png`,
    logger: silentLogger,
  })
  assert.deepEqual(updatedIds.sort(), [1, 2])
  assert.equal(audit.posts_changed, 1)
  assert.equal(audit.posts_failed, 1)
  assert.equal(audit.failures[0].post_id, 1)
  assert.equal(audit.failures[0].stage, 'update')
})

test('post listing stops at the page ceiling instead of looping forever', async () => {
  let pages = 0
  const audit = await repairPublishedPostImages({
    token: 'token',
    apply: false,
    pageSize: 1,
    maxPages: 4,
    sleepImpl: noSleep,
    fetchImpl: async (rawUrl) => {
      const url = new URL(rawUrl)
      if (url.pathname === '/api/admin/posts') {
        pages += 1
        // A backend that omits `total` and always returns a full page used to
        // spin here forever.
        return Response.json({ items: [{ id: pages, slug: `p${pages}` }] })
      }
      const id = Number(url.pathname.split('/').at(-1))
      return Response.json({ id, slug: `p${id}`, content_md: 'no images' })
    },
    logger: silentLogger,
  })

  assert.equal(pages, 4)
  assert.equal(audit.posts_scanned, 4)
})
