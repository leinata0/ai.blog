import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  classifyRejectedImageUrl,
  extractImageCandidatesFromHtml,
  pickSourceImages,
} from '../lib/source-image-picker.mjs'
import { normalizeImageUrlForDedupe } from '../auto-blog.mjs'

// ---------------------------------------------------------------------------
// Regression cover for the 2026-07 duplicate-illustration incident, graded against
// markup captured from the actual source pages the pipeline cites — not hand-written
// HTML. Production sampling found 38 inline images across 25 posts collapsing to 23
// distinct URLs; every fixture here is one of the pages that produced a repeat.
//
// The files under fixtures/source-pages/ are the live pages reduced to the elements the
// picker reads (og:image / twitter:image meta, <img>, <source>, and the
// <article>/<main>/<figure>/<figcaption> containers that placement scoring depends on).
// Scripts, styles, other tags and all text nodes were removed; the retained markup and its
// nesting are byte-for-byte what the sites served, and the reduction was verified to leave
// both the extracted candidate list and the final selection unchanged.
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = resolve(__dirname, 'fixtures', 'source-pages')
const CONFIG_PATH = resolve(__dirname, '..', 'config', 'auto-blog.config.json')
// Graded with the shipped rules: the config is as much a part of the fix as the code.
const productionConfig = JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
const productionRules = productionConfig.image_selection_rules

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

const PAGES = {
  huggingface: {
    file: 'huggingface-blog-jfrog.html',
    url: 'https://huggingface.co/blog/jfrog',
    topic: 'JFrog Hugging Face model security',
  },
  blogGoogle: {
    file: 'blog-google-uk-productivity.html',
    url: 'https://blog.google/company-news/inside-google/around-the-globe/google-europe/united-kingdom/unlocking-britains-next-era-of-productivity-building-a-nation-of-ai-trailblazers/',
    topic: 'Britain AI productivity trailblazers',
  },
  stratecheryPost: {
    file: 'stratechery-post.html',
    url: 'https://stratechery.com/2026/mainframes-and-main-characters/',
    topic: 'IBM mainframes OpenAI',
  },
  stratecheryIndex: {
    file: 'stratechery-archive-index.html',
    url: 'https://stratechery.com/2026/',
    topic: 'Stratechery 2026 archive',
  },
  sspai: {
    file: 'sspai-post.html',
    url: 'https://sspai.com/post/112425',
    topic: 'shaoshupai efficiency tools',
  },
  techcrunch: {
    file: 'techcrunch-post.html',
    url: 'https://techcrunch.com/2026/07/20/google-is-working-on-a-new-ai-chip-designed-to-make-gemini-more-efficient/',
    topic: 'Google AI chip Gemini efficiency',
  },
}

const htmlCache = new Map()
async function fixtureHtml(name) {
  if (!htmlCache.has(name)) {
    htmlCache.set(name, await readFile(resolve(FIXTURE_DIR, PAGES[name].file), 'utf8'))
  }
  return htmlCache.get(name)
}

async function pickFrom(name, { sections = ['## Recap', '## Breakdown', '## Outlook'], rules = productionRules, excludeUrls } = {}) {
  const page = PAGES[name]
  const html = await fixtureHtml(name)
  const warnings = []
  const plans = await pickSourceImages({
    sections,
    topic: page.topic,
    sourceItems: [{
      url: page.url,
      source_name: name,
      title: page.topic,
      source_type: 'industry_media',
      is_primary: true,
    }],
    config: { image_selection_rules: rules },
    fetchImpl: async () => new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    pinAddresses: false,
    lookupImpl: publicLookup,
    logger: { warn: (message) => warnings.push(String(message)), log() {} },
    normalizeUrlForDedupe: normalizeImageUrlForDedupe,
    excludeUrls,
  })
  return { plans, warnings, urls: plans.map((plan) => plan.image_url) }
}

async function metaImagesOf(name) {
  const page = PAGES[name]
  return extractImageCandidatesFromHtml(await fixtureHtml(name), page.url)
    .filter((candidate) => candidate.kind === 'meta-image')
    .map((candidate) => candidate.url)
}

// --- the share cards that actually repeated in production ------------------

async function declaredOgImage(name) {
  const html = await fixtureHtml(name)
  return /<meta\s+property="og:image"\s+content="([^"]+)"/i.exec(html)?.[1] || ''
}

test('the s0.wp.com card generator that appeared in five articles is never selected', async () => {
  // This exact URL was the single worst offender in the sample. It carries no blocklist
  // keyword at all: the picture identity lives in a base64 query behind a two-character
  // path, and the card renders the site's name rather than anything about the article.
  const declared = await declaredOgImage('stratecheryIndex')
  assert.match(declared, /^https:\/\/s0\.wp\.com\/_si\/\?t=eyJpbWciOi/)

  // It does not even survive candidate extraction: its path is `/_si/`, and a URL whose path
  // ends in a slash is a directory, not an image file.
  const candidates = extractImageCandidatesFromHtml(await fixtureHtml('stratecheryIndex'), PAGES.stratecheryIndex.url)
  assert.ok(!candidates.some((candidate) => candidate.url.includes('s0.wp.com')))

  const { plans, warnings } = await pickFrom('stratecheryIndex')
  assert.deepEqual(plans, [], 'a site-wide share card must never become an article illustration')
  assert.ok(
    warnings.some((line) => line.includes('no in-article image')),
    `expected a warning explaining the empty result, got: ${JSON.stringify(warnings)}`,
  )
})

test('the s0.wp.com card is rejected on its URL alone, by two independent rules', async () => {
  const declared = await declaredOgImage('stratecheryIndex')
  assert.equal(classifyRejectedImageUrl(declared, productionRules), 'social_card_path_segment')

  // Defence in depth: the same generator without the trailing slash — so no longer a
  // directory URL — is still caught, because `_si` is a known card-endpoint path segment.
  const noSlash = declared.replace('/_si/?t=', '/_si?t=')
  assert.equal(classifyRejectedImageUrl(noSlash, productionRules), 'social_card_path_segment')

  // And a card generator under an unknown endpoint name is caught by shape alone: a short
  // extensionless path with a long query.
  assert.equal(
    classifyRejectedImageUrl('https://cdn.example.com/gen?t=eyJpbWciOiJodHRwczovL2V4YW1wbGUuY29tIn0', productionRules),
    'generated_card_endpoint',
  )
  // ...while a real CDN URL with a long opaque id and a long query stays allowed.
  assert.equal(
    classifyRejectedImageUrl('https://images.unsplash.com/photo-1518791841217-8f162f1e1131?ixlib=rb-4.0.3&auto=format&fit=crop&w=1400', productionRules),
    '',
  )
})

test('enabling the meta-image fallback still refuses the share card', async () => {
  // allow_meta_image_fallback is the escape hatch for sites that only expose og:image. It
  // must not become a way back to publishing social cards.
  const { plans } = await pickFrom('stratecheryIndex', {
    rules: { ...productionRules, allow_meta_image_fallback: true },
  })
  assert.deepEqual(plans, [])
})

test('sspai pages whose body images are script-injected fall back to their own per-article cover', async () => {
  // Behaviour change, on purpose. sspai renders its body client-side, so the static HTML
  // holds nothing but avatars, QR codes and a placeholder — every one of them correctly
  // dropped. Refusing the og:image on top of that left the article with no picture at all,
  // and pages shaped like this (Hugging Face, sspai, most vendor blogs) are a large share
  // of why production fell from 38 illustrations to 14.
  //
  // What makes accepting it safe is that this og:image is not a card: it is
  // `/17/07/2026/article/<uuid>.jpeg`, a per-article asset, and cross-article
  // de-duplication means any single picture can be published at most once anyway.
  const { plans, warnings } = await pickFrom('sspai')
  assert.equal(plans.length, 1)
  assert.match(plans[0].reason, /meta_image_fallback/)
  assert.match(plans[0].image_url, /rssfile\.sspai\.com\/17\/07\/2026\/article\//)
  // The chrome that must stay rejected regardless.
  assert.ok(!/placeholder|qrcode|logo|72x72|100x100/.test(plans[0].image_url))
  assert.ok(warnings.some((line) => line.includes('no in-article image')))
  // And it stays a one-off: the remaining sections do not get filled with the same card.
  assert.equal(new Set(plans.map((plan) => plan.image_url)).size, plans.length)
})

test('the meta fallback is refused for any source page that does expose body images', async () => {
  // Per-source gating, not a global switch: blog.google and stratechery both publish a
  // real og:image-shaped card, and both have body images, so the card is unreachable.
  for (const name of ['blogGoogle', 'stratecheryPost', 'techcrunch', 'huggingface']) {
    const metas = new Set(await metaImagesOf(name))
    const { plans } = await pickFrom(name)
    for (const plan of plans) {
      assert.ok(
        !/meta_image_fallback/.test(plan.reason),
        `${name} reached for its share image although the page has body images: ${plan.image_url}`,
      )
      assert.ok(!metas.has(plan.image_url), `${name} selected a share-card meta image: ${plan.image_url}`)
    }
  }
})

// --- real in-article images must still be found ----------------------------

test('a real captioned article photo wins even when its alt text says "icon"', async () => {
  // The regression that made this test exist: TechCrunch describes its 1024x521 lead photo
  // as "Gemini icon", the blocklist matched the alt text, and the only real illustration on
  // the page was dropped in favour of a 150px author avatar.
  const { urls } = await pickFrom('techcrunch')
  assert.ok(urls.length >= 1, 'the page has a genuine article photo; something must be picked')
  for (const url of urls) {
    assert.match(url, /Screenshot-2026-07-01-at-10\.00\.27-AM\.jpg/)
  }
  assert.ok(
    !urls.some((url) => url.includes('author-card') || url.includes('495cdfd5')),
    `author avatar must not be published as an illustration: ${JSON.stringify(urls)}`,
  )
})

test('two renditions of one photo cannot fill two sections of the same article', async () => {
  // TechCrunch serves the same file as `…jpg?w=1024` and `…jpg`; Stratechery as
  // `…png?resize=1330,564&ssl=1` and `…png?w=1330&ssl=1`. Both used to be picked.
  for (const name of Object.keys(PAGES)) {
    const { urls } = await pickFrom(name)
    const keys = urls.map((url) => normalizeImageUrlForDedupe(url))
    assert.equal(new Set(keys).size, keys.length, `${name} repeated one picture across sections: ${JSON.stringify(urls)}`)
  }
})

test('blog.google renditions that URL folding cannot reunite are still caught', async () => {
  // The CDN truncates the *filename* to a different length per rendition, so the two
  // halves of one hero image normalise to two different keys and no suffix rule can join
  // them. They do carry byte-identical alt text, which is what the picker folds on.
  const wide = 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/Gemini_Generated_Image_k2dxu1k2dx.width-200.format-webp.webp'
  const narrow = 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/Gemini_Generated_Image_k2dxu1k2d.width-2200.format-webp.webp'
  assert.notEqual(
    normalizeImageUrlForDedupe(wide),
    normalizeImageUrlForDedupe(narrow),
    'if URL folding ever unites these, this test is guarding nothing and should be revisited',
  )

  const { urls } = await pickFrom('blogGoogle')
  const geminiRenditions = urls.filter((url) => url.includes('Gemini_Generated_Image'))
  assert.ok(geminiRenditions.length <= 1, `one hero picture filled two sections: ${JSON.stringify(geminiRenditions)}`)
})

test('stratechery article picks its own captioned chart, not the sidebar podcast badges', async () => {
  const { urls } = await pickFrom('stratecheryPost')
  assert.ok(urls.length >= 1)
  for (const url of urls) {
    assert.match(url, /twis-ibm-openai-1\.png/)
    assert.ok(!/podcast|sharptech|dithering/i.test(url), `128x128 sidebar badge leaked in: ${url}`)
  }
})

test('128x128 sidebar badges are rejected on the size declared in their query string', async () => {
  // The markup carries no width/height attribute at all, so min_width was previously dead
  // and a podcast cover badge counted as a candidate illustration.
  assert.equal(
    classifyRejectedImageUrl('https://i0.wp.com/sharptech.fm/assets/Sharp%20Tech%20-%20Black.png?w=128&h=128&ssl=1', productionRules),
    'min_width',
  )
  assert.equal(
    classifyRejectedImageUrl('https://cdnfile.sspai.com/2026/06/01/ce0d.jpg?imageMogr2/auto-orient/thumbnail/!72x72r/gravity/center/crop/72x72/ignore-error/1', productionRules),
    'min_width',
  )
  // A genuine large rendition on the same CDN pattern stays allowed.
  assert.equal(
    classifyRejectedImageUrl('https://i0.wp.com/stratechery.com/wp-content/uploads/2026/07/twis-ibm-openai-1.png?resize=1330,564&ssl=1', productionRules),
    '',
  )
})

test('hugging face blog posts yield their own article images, never the shared social thumbnail', async () => {
  const { urls } = await pickFrom('huggingface')
  assert.ok(urls.length >= 1)
  for (const url of urls) {
    assert.ok(!url.includes('cdn-thumbnails.huggingface.co'), `social-thumbnails CDN leaked in: ${url}`)
    assert.ok(!/\/avatars?\//.test(url) && !url.includes('cdn-avatars'), `avatar leaked in: ${url}`)
    assert.ok(!/huggingface_logo/.test(url), `site logo leaked in: ${url}`)
  }
})

test('the shared social-thumbnails CDN path is rejected while a per-article thumbnail is not', async () => {
  // Two Hugging Face posts in the sample shared one `/social-thumbnails/` image. The
  // per-article `/blog/assets/<slug>/thumbnail.png` form is legitimate and must survive:
  // blanket-blocking the word "thumbnail" would have removed real illustrations.
  assert.equal(
    classifyRejectedImageUrl('https://cdn-thumbnails.huggingface.co/social-thumbnails/blog/Arm/ai-sound-gen-on-arm.png', productionRules),
    'blocklist_keyword',
  )
  assert.equal(
    classifyRejectedImageUrl('https://huggingface.co/blog/assets/jfrog/thumbnail.png', productionRules),
    '',
  )
})

test('blog.google articles pick their own screenshots over the site-wide Gemini card', async () => {
  const [card] = await metaImagesOf('blogGoogle')
  assert.match(card, /Gemini_Generated_Image_k2dxu1k2dxu1k2dx/)

  const { urls } = await pickFrom('blogGoogle')
  assert.ok(urls.length >= 1)
  assert.ok(!urls.includes(card), 'the og:image share card must not be selected')
  assert.ok(
    urls.some((url) => /Screenshot_2026|original_images/.test(url)),
    `expected a real in-article asset, got: ${JSON.stringify(urls)}`,
  )
})

test('google CDN size renditions of one screenshot collapse to a single dedupe key', async () => {
  // `.width-1200.format-webp.webp` and `.width-2000.format-webp.webp` are one picture. The
  // format suffix sits after the size suffix, which is why the size had to be stripped in
  // more than one pass.
  const base = 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/Screenshot_2026-06-29_7.34.05_PM'
  assert.equal(
    normalizeImageUrlForDedupe(`${base}.width-1200.format-webp.webp`),
    normalizeImageUrlForDedupe(`${base}.width-2000.format-webp.webp`),
  )
  // The truncated-name variants of the site-wide Gemini card also converge, which is what
  // stops it recurring across articles once one article has used it.
  assert.equal(
    normalizeImageUrlForDedupe('https://storage.googleapis.com/gweb-uniblog-publish-prod/images/Gemini_Generated_Image_k2dxu1k2dxu1k2dx.width-1300.png'),
    normalizeImageUrlForDedupe('https://storage.googleapis.com/gweb-uniblog-publish-prod/images/Gemini_Generated_Image_k2dxu1k2dx.width-200.png'),
  )
  // Two genuinely different screenshots must stay apart.
  assert.notEqual(
    normalizeImageUrlForDedupe(`${base}.width-1200.format-webp.webp`),
    normalizeImageUrlForDedupe('https://storage.googleapis.com/gweb-uniblog-publish-prod/images/Screenshot_2026-06-29_6.54.26_PM.width-1200.format-webp.webp'),
  )
})

// --- caller-supplied cross-article memory ----------------------------------

test('the caller can exclude an image another article already used, and the picker moves on', async () => {
  const first = await pickFrom('blogGoogle')
  assert.ok(first.urls.length >= 1)

  const second = await pickFrom('blogGoogle', { excludeUrls: [first.urls[0]] })
  assert.ok(
    !second.urls.includes(first.urls[0]),
    'an excluded image must not come back',
  )
  assert.ok(second.urls.length >= 1, 'exclusion should fall through to the next candidate, not empty the article')
})

test('exclusion is matched on the normalised key, so a different rendition of the same photo is also skipped', async () => {
  const first = await pickFrom('techcrunch')
  const chosen = first.urls[0]
  // Hand the picker a *different* rendition string for the same underlying picture.
  const otherRendition = chosen.includes('?') ? chosen.split('?')[0] : `${chosen}?w=800`
  assert.notEqual(otherRendition, chosen)

  const second = await pickFrom('techcrunch', { excludeUrls: [otherRendition] })
  assert.ok(
    !second.urls.some((url) => normalizeImageUrlForDedupe(url) === normalizeImageUrlForDedupe(chosen)),
    `the same picture came back under a different rendition: ${JSON.stringify(second.urls)}`,
  )
})

// --- the page URL must never be mistaken for an image ----------------------

test('no fixture produces its own page URL as an image candidate', async () => {
  // Published bodies contain a handful of bare article URLs from the era when an empty
  // `content=""` / `src=""` resolved to the page itself.
  for (const [name, page] of Object.entries(PAGES)) {
    const candidates = extractImageCandidatesFromHtml(await fixtureHtml(name), page.url)
    for (const candidate of candidates) {
      assert.notEqual(candidate.url, page.url, `${name} produced its own URL as a candidate`)
      assert.ok(!candidate.url.endsWith('/'), `${name} produced a directory URL: ${candidate.url}`)
    }
  }
})

test('a published article URL is classified as a non-image', async () => {
  assert.equal(
    classifyRejectedImageUrl('https://techcrunch.com/2026/07/17/vertu-wants-executives-to-pay-6880-for-an-ai-agent-heres-how-it-actually-performs/', productionRules),
    'directory_url',
  )
})

// --- every fixture, end to end --------------------------------------------

test('any meta image that does get selected still passes every share-card rule', async () => {
  // og:image is reachable again (see the sspai case above), so the invariant is no longer
  // "never a meta image" but "never a share card, and only when the page offered nothing
  // else". Both halves are checked here across all six real pages.
  for (const name of Object.keys(PAGES)) {
    const metas = new Set(await metaImagesOf(name))
    const { plans } = await pickFrom(name)
    for (const plan of plans) {
      if (!metas.has(plan.image_url)) continue
      assert.match(plan.reason, /meta_image_fallback/, `${name} selected a meta image outside the fallback tier`)
      assert.equal(
        classifyRejectedImageUrl(plan.image_url, productionRules),
        '',
        `${name} published a meta image that the URL rules reject: ${plan.image_url}`,
      )
      assert.ok(
        !/social|share|_si|opengraph|og-image|twitter-card|placeholder/i.test(plan.image_url),
        `${name} published a share-card shaped meta image: ${plan.image_url}`,
      )
    }
  }
})

test('across all six real pages, no picture is published twice', async () => {
  // The reader-visible symptom being fixed. One shared memory, six articles, one pass.
  const seen = new Set()
  const repeats = []
  for (const name of Object.keys(PAGES)) {
    const { urls } = await pickFrom(name, { excludeUrls: [...seen] })
    for (const url of urls) {
      const key = normalizeImageUrlForDedupe(url)
      if (seen.has(key)) repeats.push({ name, url })
      seen.add(key)
    }
  }
  assert.deepEqual(repeats, [])
})
