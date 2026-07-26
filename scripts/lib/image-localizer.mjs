import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'

import { resolvePublicHttpUrl } from './url-guard.mjs'

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 3
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const GENERIC_BINARY_TYPES = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
])
// avif is deliberately absent: detectImageType below and the backend
// (ALLOWED_IMAGE_CONTENT_TYPES / sniff_raster_image_content_type) only accept
// PNG/JPEG/GIF/WEBP. Advertising avif makes content-negotiating CDNs
// (Cloudflare Polish, Cloudinary, Next.js image) hand back an avif body that we
// would then reject as an invalid signature — i.e. a healthy image would be
// classified as broken. Only ask for formats we can actually re-host.
const DEFAULT_IMAGE_ACCEPT = 'image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8'

function normalizedContentType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase()
}

// Download failures must be separable into "the resource is really gone" and
// "the upstream hiccuped": callers delete published images on the former and
// retry / keep the original on the latter.
function downloadFailure(message, { status = 0, permanent = false } = {}) {
  const error = new Error(message)
  error.status = status
  error.permanentFailure = permanent
  return error
}

export function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer || [])
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { contentType: 'image/png', extension: '.png' }
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: '.jpg' }
  }
  if (buffer.length >= 6) {
    const signature = buffer.subarray(0, 6).toString('ascii')
    if (signature === 'GIF87a' || signature === 'GIF89a') {
      return { contentType: 'image/gif', extension: '.gif' }
    }
  }
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { contentType: 'image/webp', extension: '.webp' }
  }
  return null
}

// Bounded body reader. Exported so every third-party response (images *and*
// HTML source pages) goes through the same size ceiling instead of calling an
// unbounded response.text() / response.arrayBuffer().
export async function readLimitedResponseBody(response, maxBytes = DEFAULT_MAX_BYTES) {
  const limit = Number(maxBytes) > 0 ? Number(maxBytes) : DEFAULT_MAX_BYTES
  const declaredLength = Number(response.headers?.get?.('content-length') || 0)
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw new Error(`Response exceeds ${limit} byte limit`)
  }

  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > limit) throw new Error(`Response exceeds ${limit} byte limit`)
    return buffer
  }

  const chunks = []
  let total = 0
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      total += chunk.length
      if (total > limit) {
        await reader.cancel('response too large')
        throw new Error(`Response exceeds ${limit} byte limit`)
      }
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock?.()
  }
  return Buffer.concat(chunks, total)
}

function headersFromIncomingMessage(message) {
  const headers = new Headers()
  for (let index = 0; index < message.rawHeaders.length; index += 2) {
    headers.append(message.rawHeaders[index], message.rawHeaders[index + 1])
  }
  return headers
}

export async function requestPinnedPublicUrl(parsedUrl, address, {
  headers = {},
  signal,
} = {}) {
  const requestImpl = parsedUrl.protocol === 'https:' ? httpsRequest : httpRequest
  const serverName = parsedUrl.hostname.replace(/^\[/, '').replace(/\]$/, '')
  return new Promise((resolve, reject) => {
    const request = requestImpl(parsedUrl, {
      method: 'GET',
      headers,
      signal,
      // Host and TLS SNI still use parsedUrl.hostname; only address selection is pinned.
      servername: isIP(serverName) ? undefined : serverName,
      lookup(_hostname, options, callback) {
        if (options?.all) callback(null, [address])
        else callback(null, address.address, address.family)
      },
    }, (message) => {
      const status = Number(message.statusCode || 0)
      const bodyForbidden = status === 204 || status === 205 || status === 304
      resolve(new Response(bodyForbidden ? null : Readable.toWeb(message), {
        status,
        statusText: message.statusMessage || '',
        headers: headersFromIncomingMessage(message),
      }))
    })
    request.on('error', reject)
    request.end()
  })
}

async function requestPinnedAddressSet(parsedUrl, addresses, options) {
  let lastError = null
  for (const address of addresses) {
    try {
      return await requestPinnedPublicUrl(parsedUrl, address, options)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('No vetted public address was available')
}

export async function fetchPublicResource(rawUrl, {
  // No default: a caller-supplied fetch is an explicit opt out of address
  // pinning (tests, mocks). Production paths pass nothing and stay pinned.
  fetchImpl,
  // Set to false to acknowledge that the injected transport cannot be pinned.
  // Leaving it true while injecting a fetch is a fail-open and gets logged.
  pinAddresses = true,
  lookupImpl,
  timeoutMs = 15000,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  userAgent = 'Mozilla/5.0 (compatible; AutoBlogImageLocalizer/1.0)',
  accept = DEFAULT_IMAGE_ACCEPT,
  transportImpl,
  logger = console,
} = {}) {
  let currentUrl = String(rawUrl || '').trim()
  let previousProtocol = ''
  // Identity-comparing globalThis.fetch used to decide this, so any APM/polyfill
  // that replaced fetch after module load silently disabled DNS pinning. Now the
  // decision is explicit and an unacknowledged downgrade is logged.
  const usesInjectedTransport = typeof transportImpl === 'function' || typeof fetchImpl === 'function'
  if (typeof fetchImpl === 'function' && pinAddresses !== false) {
    logger?.warn?.('fetchPublicResource: DNS pinning disabled because a custom fetch implementation was supplied')
  }

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const resolved = await resolvePublicHttpUrl(currentUrl, { lookupImpl })
    const parsed = resolved.url
    if (previousProtocol === 'https:' && parsed.protocol !== 'https:') {
      throw new Error('Unsafe redirect: HTTPS downgrade is not allowed')
    }

    const requestOptions = {
      headers: { Accept: accept, 'User-Agent': userAgent },
      signal: AbortSignal.timeout(timeoutMs),
    }
    let response
    if (typeof transportImpl === 'function') {
      response = await transportImpl(parsed, resolved.addresses[0], requestOptions)
    } else if (typeof fetchImpl === 'function') {
      response = await fetchImpl(parsed.toString(), { ...requestOptions, redirect: 'manual' })
    } else {
      response = await requestPinnedAddressSet(parsed, resolved.addresses, requestOptions)
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, finalUrl: parsed.toString(), pinned: !usesInjectedTransport }
    }
    if (redirectCount >= maxRedirects) throw new Error(`Too many redirects (>${maxRedirects})`)

    const location = response.headers?.get?.('location')
    if (!location) throw new Error(`Redirect ${response.status} is missing Location`)
    await response.body?.cancel?.()
    previousProtocol = parsed.protocol
    currentUrl = new URL(location, parsed).toString()
  }

  throw new Error('Too many redirects')
}

export async function downloadVerifiedImage(imageUrl, options = {}) {
  const maxBytes = Number(options.maxBytes || DEFAULT_MAX_BYTES)
  const { response, finalUrl } = await fetchPublicResource(imageUrl, options)
  if (!response.ok) {
    // Only 404/410 prove the image is gone for good. Everything else (403 hotlink
    // protection, 429 throttling, 5xx) is treated as transient by callers.
    throw downloadFailure(`Image download failed: HTTP ${response.status}`, {
      status: response.status,
      permanent: response.status === 404 || response.status === 410,
    })
  }

  const advertisedType = normalizedContentType(response.headers?.get?.('content-type'))
  if (!advertisedType.startsWith('image/') && !GENERIC_BINARY_TYPES.has(advertisedType)) {
    // A WAF/consent interstitial also produces text/html, so this is not proof
    // the image is dead — never escalate it to a deletion.
    throw downloadFailure(`Image download returned unsupported Content-Type: ${advertisedType || 'missing'}`, {
      status: response.status,
    })
  }

  const buffer = await readLimitedResponseBody(response, maxBytes)
  if (buffer.length < 64) throw downloadFailure('Image payload is too small', { status: response.status })
  const detected = detectImageType(buffer)
  if (!detected) {
    throw downloadFailure('Image payload has an unsupported or invalid file signature', {
      status: response.status,
      permanent: true,
    })
  }

  return {
    buffer,
    contentType: detected.contentType,
    extension: detected.extension,
    finalUrl,
  }
}

export async function uploadLocalizedImage({
  image,
  token,
  blogApiBase,
  fetchImpl = fetch,
  timeoutMs = 15000,
  now = () => Date.now(),
} = {}) {
  if (!token) throw new Error('Image upload failed: missing admin token')
  if (!blogApiBase) throw new Error('Image upload failed: missing API base URL')

  const uniqueSuffix = randomUUID().replaceAll('-', '').slice(0, 12)
  const filename = `auto-blog-${now()}-${uniqueSuffix}${image.extension}`
  const boundary = `----AutoBlogImage${now()}${uniqueSuffix}`
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${image.contentType}\r\n\r\n`
  const footer = `\r\n--${boundary}--\r\n`
  const body = Buffer.concat([Buffer.from(header), image.buffer, Buffer.from(footer)])
  const response = await fetchImpl(`${String(blogApiBase).replace(/\/$/, '')}/api/admin/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`Image upload failed: HTTP ${response.status}`)

  const payload = await response.json()
  const rawUrl = String(payload?.url || '').trim()
  if (!rawUrl) throw new Error('Image upload failed: response did not include a URL')
  return new URL(rawUrl, `${String(blogApiBase).replace(/\/$/, '')}/`).toString()
}

// Same work as localizeImagePlans, but the caller also gets the per-plan
// failures so a pipeline can surface "3 of 4 inline images were dropped"
// instead of only emitting warn lines nobody aggregates.
export async function localizeImagePlansWithReport(imagePlans, {
  token,
  blogApiBase,
  fetchImpl,
  pinAddresses = true,
  lookupImpl,
  logger = console,
  maxBytes = DEFAULT_MAX_BYTES,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
} = {}) {
  const localized = []
  const failures = []
  const plans = Array.isArray(imagePlans) ? imagePlans : []
  for (const plan of plans) {
    const originalUrl = String(plan?.image_url || '').trim()
    if (!originalUrl) continue
    try {
      const image = await downloadVerifiedImage(originalUrl, {
        fetchImpl,
        pinAddresses,
        lookupImpl,
        maxBytes,
        maxRedirects,
        logger,
      })
      const uploadedUrl = await uploadLocalizedImage({ image, token, blogApiBase, fetchImpl })
      localized.push({
        ...plan,
        image_url: uploadedUrl,
        original_image_url: originalUrl,
        uploaded_image_url: uploadedUrl,
      })
    } catch (error) {
      const reason = error?.message || 'localization failed'
      failures.push({ image_url: originalUrl, section_heading: plan?.section_heading || '', reason })
      logger?.warn?.(`Inline image omitted (${originalUrl}): ${reason}`)
    }
  }
  if (failures.length > 0) {
    logger?.warn?.(`Inline image localization dropped ${failures.length}/${plans.length} planned image(s).`)
  }
  return { plans: localized, failures }
}

export async function localizeImagePlans(imagePlans, options = {}) {
  return (await localizeImagePlansWithReport(imagePlans, options)).plans
}
