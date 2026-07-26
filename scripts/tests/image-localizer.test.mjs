import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import {
  detectImageType,
  downloadVerifiedImage,
  fetchPublicResource,
  localizeImagePlans,
  localizeImagePlansWithReport,
  readLimitedResponseBody,
  requestPinnedPublicUrl,
} from '../lib/image-localizer.mjs'

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]
const silentLogger = { warn() {}, log() {} }

function pngBytes(size = 96) {
  const bytes = Buffer.alloc(size, 0)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes)
  return bytes
}

test('detectImageType recognizes supported image signatures', () => {
  assert.equal(detectImageType(pngBytes()).contentType, 'image/png')
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, ...new Array(80).fill(0)])).contentType, 'image/jpeg')
  assert.equal(detectImageType(Buffer.from(`GIF89a${'x'.repeat(80)}`)).contentType, 'image/gif')
  assert.equal(detectImageType(Buffer.from(`RIFFxxxxWEBP${'x'.repeat(80)}`)).contentType, 'image/webp')
  assert.equal(detectImageType(Buffer.from('<html>not an image</html>')), null)
})

test('the Accept header never asks for a format detectImageType cannot verify', async () => {
  let accept = ''
  await fetchPublicResource('https://cdn.example.com/image.png', {
    lookupImpl: publicLookup,
    pinAddresses: false,
    fetchImpl: async (_url, options) => {
      accept = options.headers.Accept
      return new Response(pngBytes(), { status: 200, headers: { 'Content-Type': 'image/png' } })
    },
  })

  // Advertising avif makes content-negotiating CDNs return an avif body that we
  // would then reject as an invalid signature, i.e. delete a healthy image.
  assert.doesNotMatch(accept, /avif/)
  for (const type of ['image/webp', 'image/png', 'image/jpeg', 'image/gif']) {
    assert.match(accept, new RegExp(type.replace('/', '\\/')))
  }
})

test('downloadVerifiedImage accepts octet-stream only when magic bytes identify an image', async () => {
  const image = await downloadVerifiedImage('https://cdn.example.com/image', {
    lookupImpl: publicLookup,
    pinAddresses: false,
    fetchImpl: async () => new Response(pngBytes(), {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    }),
  })

  assert.equal(image.contentType, 'image/png')
  assert.equal(image.extension, '.png')
})

test('downloadVerifiedImage rejects HTML and invalid image signatures', async () => {
  await assert.rejects(
    downloadVerifiedImage('https://cdn.example.com/error', {
      lookupImpl: publicLookup,
      pinAddresses: false,
      fetchImpl: async () => new Response('<html>access denied</html>'.repeat(5), {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    }),
    /unsupported Content-Type/,
  )

  await assert.rejects(
    downloadVerifiedImage('https://cdn.example.com/fake.png', {
      lookupImpl: publicLookup,
      pinAddresses: false,
      fetchImpl: async () => new Response(Buffer.alloc(96, 1), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }),
    }),
    /invalid file signature/,
  )
})

test('download failures carry the status and only 404/410 are marked permanent', async () => {
  const failFor = async (status) => {
    try {
      await downloadVerifiedImage('https://cdn.example.com/x.png', {
        lookupImpl: publicLookup,
        pinAddresses: false,
        fetchImpl: async () => new Response('nope', { status }),
      })
      return null
    } catch (error) {
      return error
    }
  }

  const gone = await failFor(404)
  assert.equal(gone.status, 404)
  assert.equal(gone.permanentFailure, true)

  const removed = await failFor(410)
  assert.equal(removed.permanentFailure, true)

  for (const status of [403, 429, 500, 503]) {
    const transient = await failFor(status)
    assert.equal(transient.status, status)
    assert.equal(transient.permanentFailure, false, `HTTP ${status} must not be permanent`)
  }
})

test('a body that is not an image is permanent, but an interstitial content-type is not', async () => {
  const invalidSignature = await downloadVerifiedImage('https://cdn.example.com/fake.png', {
    lookupImpl: publicLookup,
    pinAddresses: false,
    fetchImpl: async () => new Response(Buffer.alloc(96, 1), {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    }),
  }).catch((error) => error)
  assert.equal(invalidSignature.permanentFailure, true)

  const interstitial = await downloadVerifiedImage('https://cdn.example.com/blocked.png', {
    lookupImpl: publicLookup,
    pinAddresses: false,
    fetchImpl: async () => new Response('<html>captcha</html>'.repeat(5), {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }),
  }).catch((error) => error)
  assert.equal(interstitial.permanentFailure, false)
})

test('readLimitedResponseBody refuses oversized bodies by declared length and by stream', async () => {
  await assert.rejects(
    readLimitedResponseBody(new Response('x'.repeat(100), {
      headers: { 'Content-Length': '100' },
    }), 32),
    /exceeds 32 byte limit/,
  )

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(64))
      controller.enqueue(new Uint8Array(64))
      controller.close()
    },
  })
  await assert.rejects(readLimitedResponseBody(new Response(stream), 32), /exceeds 32 byte limit/)

  const body = await readLimitedResponseBody(new Response('ok'), 32)
  assert.equal(body.toString('utf8'), 'ok')
})

test('fetchPublicResource validates redirect targets and rejects private redirects', async () => {
  let calls = 0
  await assert.rejects(
    fetchPublicResource('https://cdn.example.com/image.png', {
      lookupImpl: publicLookup,
      pinAddresses: false,
      fetchImpl: async () => {
        calls += 1
        return new Response(null, {
          status: 302,
          headers: { Location: 'http://127.0.0.1/metadata' },
        })
      },
    }),
    /private or link-local|HTTPS downgrade/,
  )
  assert.equal(calls, 1)
})

test('fetchPublicResource follows a bounded public redirect after revalidation', async () => {
  const urls = []
  const result = await fetchPublicResource('https://cdn.example.com/old.png', {
    lookupImpl: publicLookup,
    pinAddresses: false,
    fetchImpl: async (url) => {
      urls.push(String(url))
      if (urls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://assets.example.com/new.png' },
        })
      }
      return new Response(pngBytes(), { status: 200, headers: { 'Content-Type': 'image/png' } })
    },
  })

  assert.equal(result.finalUrl, 'https://assets.example.com/new.png')
  assert.deepEqual(urls, [
    'https://cdn.example.com/old.png',
    'https://assets.example.com/new.png',
  ])
})

test('an injected fetch disables address pinning loudly instead of silently', async () => {
  const warnings = []
  const result = await fetchPublicResource('https://cdn.example.com/image.png', {
    lookupImpl: publicLookup,
    logger: { warn: (message) => warnings.push(message) },
    fetchImpl: async () => new Response(pngBytes(), { status: 200, headers: { 'Content-Type': 'image/png' } }),
  })

  assert.equal(result.pinned, false)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /DNS pinning disabled/)
})

test('fetchPublicResource pins the connection to the vetted address to prevent DNS rebinding', async () => {
  let lookupCalls = 0
  let pinnedAddress = null
  const result = await fetchPublicResource('https://rebind.example.com/image.png', {
    lookupImpl: async () => {
      lookupCalls += 1
      if (lookupCalls > 1) return [{ address: '127.0.0.1', family: 4 }]
      return [{ address: '93.184.216.34', family: 4 }]
    },
    transportImpl: async (parsed, address) => {
      assert.equal(parsed.hostname, 'rebind.example.com')
      pinnedAddress = address.address
      return new Response(pngBytes(), { status: 200, headers: { 'Content-Type': 'image/png' } })
    },
  })

  assert.equal(result.finalUrl, 'https://rebind.example.com/image.png')
  assert.equal(lookupCalls, 1)
  assert.equal(pinnedAddress, '93.184.216.34')
})

test('requestPinnedPublicUrl connects to the pinned IP while preserving the origin Host', async (t) => {
  let receivedHost = ''
  const server = createServer((request, response) => {
    receivedHost = request.headers.host || ''
    response.writeHead(200, { 'Content-Type': 'image/png' })
    response.end(pngBytes())
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const port = server.address().port

  const response = await requestPinnedPublicUrl(
    new URL(`http://origin.example:${port}/image.png`),
    { address: '127.0.0.1', family: 4 },
  )
  await response.arrayBuffer()

  assert.equal(response.status, 200)
  assert.equal(receivedHost, `origin.example:${port}`)
})

test('localizeImagePlans uploads verified bytes and omits failed external images', async () => {
  const warnings = []
  const calls = []
  let uploadCalls = 0
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    if (String(url).includes('good.png')) {
      return new Response(pngBytes(), {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    }
    if (String(url).includes('broken.png')) {
      return new Response('denied', { status: 403, headers: { 'Content-Type': 'text/plain' } })
    }
    if (String(url).includes('upload-fails.png')) {
      return new Response(pngBytes(), { status: 200, headers: { 'Content-Type': 'image/png' } })
    }
    if (String(url).endsWith('/api/admin/upload')) {
      uploadCalls += 1
      assert.match(options.headers['Content-Type'], /multipart\/form-data/)
      assert.ok(Buffer.from(options.body).includes(Buffer.from('Content-Type: image/png')))
      if (uploadCalls === 2) return new Response('storage unavailable', { status: 503 })
      return Response.json({ url: 'https://img.563118077.xyz/localized.png' })
    }
    throw new Error(`unexpected URL ${url}`)
  }

  const plans = await localizeImagePlans([
    { section_heading: '## Good', image_url: 'https://cdn.example.com/good.png' },
    { section_heading: '## Broken', image_url: 'https://cdn.example.com/broken.png' },
    { section_heading: '## Upload failure', image_url: 'https://cdn.example.com/upload-fails.png' },
  ], {
    token: 'token',
    blogApiBase: 'https://api.example.com',
    fetchImpl,
    pinAddresses: false,
    lookupImpl: publicLookup,
    logger: { warn: (message) => warnings.push(message) },
  })

  assert.equal(plans.length, 1)
  assert.equal(plans[0].image_url, 'https://img.563118077.xyz/localized.png')
  assert.equal(plans[0].original_image_url, 'https://cdn.example.com/good.png')
  assert.match(warnings[0], /broken\.png.*HTTP 403/)
  assert.match(warnings[1], /upload-fails\.png.*HTTP 503/)
  assert.match(warnings.at(-1), /dropped 2\/3 planned image/)
  assert.equal(calls.filter((call) => call.url.endsWith('/api/admin/upload')).length, 2)
})

test('localizeImagePlansWithReport surfaces per-plan failures for pipeline summaries', async () => {
  const report = await localizeImagePlansWithReport([
    { section_heading: '## Broken', image_url: 'https://cdn.example.com/broken.png' },
  ], {
    token: 'token',
    blogApiBase: 'https://api.example.com',
    fetchImpl: async () => new Response('denied', { status: 403 }),
    pinAddresses: false,
    lookupImpl: publicLookup,
    logger: silentLogger,
  })

  assert.equal(report.plans.length, 0)
  assert.equal(report.failures.length, 1)
  assert.equal(report.failures[0].image_url, 'https://cdn.example.com/broken.png')
  assert.equal(report.failures[0].section_heading, '## Broken')
  assert.match(report.failures[0].reason, /HTTP 403/)
})
