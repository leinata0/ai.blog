import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { XMLParser } from 'fast-xml-parser'

import { extractFeedItemMediaCandidates, mergeMediaCandidates } from '../lib/feed-media.mjs'
import {
  normalizeSectionTargets,
  pickSourceImages,
} from '../lib/source-image-picker.mjs'
import {
  buildSectionSourceAttribution,
  fillSectionsFromHarvestedMedia,
  normalizeImageUrlForDedupe,
} from '../auto-blog.mjs'

// ---------------------------------------------------------------------------
// Seam tests for the image pipeline.
//
// The illustration work is split across three modules that were each changed
// independently: lib/feed-media.mjs extracts candidates out of the RSS response and the
// Jina markdown, auto-blog.mjs computes which sources a section actually cites, and
// lib/source-image-picker.mjs does the ranking. The previous attempt at this fix shipped
// with a parameter renamed on one side of one of those seams; every unit test stayed
// green and the feature did precisely nothing in production.
//
// So these tests do not check that a function "supports" a field. They push a value in at
// one end and assert it changed the decision at the other end — a rename anywhere along
// the chain has to make one of them fail.
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url))
const FEED_FIXTURE = resolve(__dirname, 'fixtures', 'feeds', 'cn-mixed-fulltext.xml')
const CONFIG_PATH = resolve(__dirname, '..', 'config', 'auto-blog.config.json')

const productionConfig = JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
const productionRules = productionConfig.image_selection_rules

// Same parser configuration blogwatcher uses; `removeNSPrefix` must stay off or the
// `content:encoded` key the extractor reads disappears.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
  trimValues: true,
})

const feedXml = await readFile(FEED_FIXTURE, 'utf8')
const feedEntries = parser.parse(feedXml).rss.channel.item
const STRATECHERY_URL = 'https://stratechery.com/2026/mainframes-and-main-characters/'
const SSPAI_URL = 'https://sspai.com/post/112425'
const stratecheryMedia = extractFeedItemMediaCandidates(feedEntries[0], { baseUrl: STRATECHERY_URL })
const sspaiMedia = extractFeedItemMediaCandidates(feedEntries[1], { baseUrl: SSPAI_URL })

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

// Both source pages are unreachable, which is the production failure mode this whole
// change exists for: JS-rendered bodies, paywalls and bot walls leave the page scraper
// with nothing, while the feed response already carried the article's own pictures.
const deadPages = async () => new Response('', { status: 503 })

const SECTIONS = [
  '## 材料瓶颈正在成为下一代AI的硬约束',
  '## 芯片与推理成本的拉锯',
]

const ATTRIBUTION = {
  [SECTIONS[0]]: {
    heading: SECTIONS[0],
    source_ids: ['S2'],
    source_urls: [SSPAI_URL],
    text: '材料与先进封装的良率、晶圆成本曲线与供应链约束',
    origin: 'body_citation',
  },
  [SECTIONS[1]]: {
    heading: SECTIONS[1],
    source_ids: ['S1'],
    source_urls: [STRATECHERY_URL],
    text: '推理成本、每百万 token 的美元成本与芯片代际',
    origin: 'body_citation',
  },
}

function sourceItems() {
  return [
    {
      source_id: 'S1',
      url: STRATECHERY_URL,
      title: 'Mainframes and Main Characters',
      source_name: 'Stratechery',
      source_type: 'industry_media',
      media_candidates: stratecheryMedia,
    },
    {
      source_id: 'S2',
      url: SSPAI_URL,
      title: '少数派效率工具评测',
      source_name: '少数派',
      source_type: 'industry_media',
      media_candidates: sspaiMedia,
    },
  ]
}

async function pick(overrides = {}) {
  return pickSourceImages({
    sections: SECTIONS,
    topic: 'AI 材料与算力',
    sourceItems: sourceItems(),
    config: { image_selection_rules: productionRules },
    fetchImpl: deadPages,
    pinAddresses: false,
    lookupImpl: publicLookup,
    logger: { warn() {}, log() {} },
    normalizeUrlForDedupe: normalizeImageUrlForDedupe,
    ...overrides,
  })
}

// --- seam 1: lib/feed-media.mjs -> lib/source-image-picker.mjs -------------------------

test('feed bodies illustrate an article whose source pages cannot be fetched at all', async () => {
  const plans = await pick({ sectionAttribution: ATTRIBUTION })

  assert.equal(plans.length, SECTIONS.length, `every section should be illustrated, got ${JSON.stringify(plans, null, 2)}`)
  for (const plan of plans) {
    assert.match(plan.image_url, /^https:\/\//)
  }
  // Without the feed candidates there is nothing at all: this is the size of the gain,
  // not a nice-to-have on top of the page scraper.
  const withoutFeed = await pick({
    sectionAttribution: ATTRIBUTION,
    sourceItems: sourceItems().map(({ media_candidates: _ignored, ...rest }) => rest),
  })
  assert.deepEqual(withoutFeed, [], 'the page fetch fails, so the feed body must be the only supply')
})

test('the picker reads media_candidates, the exact field name auto-blog forwards', async () => {
  // lib/feed-media.mjs writes `media_candidates`; the picker was originally written
  // against `image_candidates`. Both names must work, because a rename on either side of
  // this seam is invisible — the pipeline just quietly stops finding pictures.
  const underOldName = await pick({
    sectionAttribution: ATTRIBUTION,
    sourceItems: sourceItems().map(({ media_candidates: media, ...rest }) => ({ ...rest, image_candidates: media })),
  })
  const underNewName = await pick({ sectionAttribution: ATTRIBUTION })
  assert.ok(underNewName.length > 0)
  assert.deepEqual(
    underOldName.map((plan) => plan.image_url),
    underNewName.map((plan) => plan.image_url),
  )
})

test('feed nuisance images never become illustrations', async () => {
  // The fixture carries a 1x1 pixel.wp.com beacon, an ads.example.com banner, an author
  // avatar and a /social-thumbnails/ share card, all inside `content:encoded`. "It came
  // from the article body" is provenance, not a free pass.
  const plans = await pick({ sectionAttribution: ATTRIBUTION })
  const urls = plans.map((plan) => plan.image_url).join(' ')
  for (const rejected of ['pixel.wp.com', 'ads.example.com', '/avatar/', 'social-thumbnails']) {
    assert.ok(!urls.includes(rejected), `${rejected} must never be selected, got ${urls}`)
  }
})

// --- seam 2: auto-blog.mjs attribution -> lib/source-image-picker.mjs scoring ----------

test('sectionAttribution reaches the scorer and decides which source each section draws from', async () => {
  const plans = await pick({ sectionAttribution: ATTRIBUTION })
  const bySection = new Map(plans.map((plan) => [plan.section_heading, plan]))

  // The materials section cites S2 (sspai) and the cost section cites S1 (stratechery).
  // Both sources offer captioned, correctly-sized figures, so nothing but the attribution
  // can produce this split — and it is the reverse of what the topic words alone suggest.
  assert.equal(bySection.get(SECTIONS[0]).source_id, 'S2')
  assert.equal(bySection.get(SECTIONS[1]).source_id, 'S1')
  assert.equal(bySection.get(SECTIONS[0]).reason, 'section_source:S2')
  assert.equal(bySection.get(SECTIONS[1]).reason, 'section_source:S1')

  // Drop the attribution and the split is no longer guaranteed; this asserts the signal
  // is doing work rather than agreeing with the default ordering by coincidence.
  const unattributed = await pick()
  assert.ok(
    unattributed.every((plan) => !String(plan.reason).startsWith('section_source:')),
    'no plan may claim attribution when none was supplied',
  )
})

test('normalizeSectionTargets merges the out-of-band attribution map into plain string sections', () => {
  // auto-blog fixes the heading list before it can compute attribution, so it passes the
  // two separately. Heading keys are compared on a stripped form: `## ` markers and
  // full-width punctuation differ between the outline, the body and the map.
  const [target] = normalizeSectionTargets(['## 材料瓶颈正在成为下一代AI的硬约束'], {
    '材料瓶颈正在成为下一代AI的硬约束': { source_ids: ['S4'], text: '材料与封装' },
  })
  assert.ok(target.sourceIds.has('s4'))
  assert.equal(target.text, '材料与封装')
})

test('attribution is a preference, not a filter', async () => {
  // A hallucinated source id must cost the article a little ranking quality, never all of
  // its illustrations. The model does emit `[S9]` against a six-source pack.
  const plans = await pick({
    sectionAttribution: Object.fromEntries(SECTIONS.map((heading) => [heading, { heading, source_ids: ['S9'] }])),
  })
  assert.equal(plans.length, SECTIONS.length)
})

// --- seam 3: the caption/context text feed-media captures -> relevance ranking ---------

test('the Chinese figcaption decides which of a source\'s figures a section gets', async () => {
  // Both sspai figures are captioned Chinese body images of the same size from the same
  // source, so attribution and every structural signal tie. The only thing that can
  // separate them is the caption text, which is also the only Chinese text about the
  // picture that exists anywhere in the pipeline.
  const materials = await pick({ sectionAttribution: ATTRIBUTION })
  const chosen = materials.find((plan) => plan.section_heading === SECTIONS[0])
  assert.match(chosen.image_url, /thermal-throttle/, '材料瓶颈 must get the 材料瓶颈 caption, not the throughput chart')

  // Same source, same candidates, a section about throughput instead: the choice flips.
  const throughput = await pickSourceImages({
    sections: [SECTIONS[0]],
    topic: 'AI 材料与算力',
    sourceItems: sourceItems(),
    sectionAttribution: {
      [SECTIONS[0]]: { heading: SECTIONS[0], source_ids: ['S2'], text: '不同量化精度下本地推理的吞吐对比' },
    },
    config: { image_selection_rules: productionRules },
    fetchImpl: deadPages,
    pinAddresses: false,
    lookupImpl: publicLookup,
    logger: { warn() {}, log() {} },
    normalizeUrlForDedupe: normalizeImageUrlForDedupe,
  })
  assert.match(throughput[0].image_url, /local-inference-throughput/)
})

// --- seam 4: auto-blog's own layer-3 fill reads the same candidates --------------------

test('the harvested-media fallback layer consumes the same media_candidates field', () => {
  const { added } = fillSectionsFromHarvestedMedia({
    sections: SECTIONS,
    existingPlans: [],
    sourceItems: sourceItems(),
    attribution: ATTRIBUTION,
    rules: productionRules,
  })
  assert.ok(added.length > 0, 'layer 3 must be able to illustrate from feed bodies alone')
  for (const plan of added) {
    assert.ok(!plan.image_url.includes('pixel.wp.com'))
    assert.ok(!plan.image_url.includes('/avatar/'))
  }
})

test('buildSectionSourceAttribution produces exactly the shape the picker consumes', () => {
  const attribution = buildSectionSourceAttribution({
    contentMd: [
      `${SECTIONS[0]}`,
      '先进封装的良率决定了下一代芯片的成本 [S2]。',
      `${SECTIONS[1]}`,
      '推理成本随代际下降 [S1]。',
    ].join('\n\n'),
    sections: SECTIONS,
    outline: { section_briefs: [] },
    researchPack: { sources: sourceItems() },
  })

  // The end-to-end contract in one assertion: whatever auto-blog builds must be directly
  // consumable by normalizeSectionTargets without a translation layer in between.
  const targets = normalizeSectionTargets(SECTIONS, attribution)
  assert.equal(targets.length, 2)
  assert.ok(targets[0].sourceIds.has('s2'), `expected S2, got ${JSON.stringify([...targets[0].sourceIds])}`)
  assert.ok(targets[1].sourceIds.has('s1'))
  assert.ok(targets[0].text.length > 0, 'section prose must survive the hand-off')
})

// --- supply merge ---------------------------------------------------------------------

// --- seam 5: the repair tool recovers the same signals from a published body -----------

test('repair-post-media rebuilds the attribution the picker needs out of published markdown', async () => {
  process.env.TRUSTED_IMAGE_HOSTS = 'img.563118077.xyz'
  const { buildAttributionFromPublishedBody } = await import('../repair-post-media.mjs')

  // `finalizeArticle` turns the `[S1]` markers into links, so a published body still says
  // which source each section was written from — the fact the repair tool needs and, until
  // now, threw away.
  const body = [
    '## 材料瓶颈正在成为下一代AI的硬约束',
    '',
    `先进封装的良率决定了成本 [S2](${SSPAI_URL})。`,
    '',
    '## 芯片与推理成本的拉锯',
    '',
    `推理成本随代际下降 [S1](${STRATECHERY_URL})。`,
    '',
    '## 参考来源',
  ].join('\n')

  const attribution = buildAttributionFromPublishedBody(body, SECTIONS)
  assert.deepEqual(attribution[SECTIONS[0]].source_urls, [SSPAI_URL])
  assert.deepEqual(attribution[SECTIONS[1]].source_urls, [STRATECHERY_URL])
  assert.match(attribution[SECTIONS[0]].text, /先进封装的良率/)

  // And the picker must act on it: URLs that are not source ids still have to resolve to a
  // source, or the repair run ranks by document order the way the broken posts were built.
  const plans = await pick({ sectionAttribution: attribution })
  const bySection = new Map(plans.map((plan) => [plan.section_heading, plan]))
  assert.equal(bySection.get(SECTIONS[0]).source_page_url, SSPAI_URL)
  assert.equal(bySection.get(SECTIONS[1]).source_page_url, STRATECHERY_URL)
})

test('mergeMediaCandidates keeps feed and markdown views of one picture as a single candidate', () => {
  const merged = mergeMediaCandidates(
    [{ url: 'https://example.com/a.png', alt: 'a', caption: '中文说明', width: 0, height: 0 }],
    [{ url: 'https://example.com/a.png', alt: '', caption: '', width: 1200, height: 700 }],
  )
  assert.equal(merged.length, 1)
  assert.equal(merged[0].caption, '中文说明')
  assert.equal(merged[0].width, 1200)
})
