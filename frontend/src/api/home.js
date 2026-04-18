import { apiGet } from './client'
import { normalizePost, normalizeSeries } from './posts'

function normalizeHero(payload = {}) {
  return {
    image: payload?.image ?? '',
    image_alt: payload?.image_alt ?? '站点 Hero 主海报',
    preset: payload?.preset ?? 'site_hero',
    art_direction_version: payload?.art_direction_version ?? '',
  }
}

function normalizeTopicPulse(payload = {}) {
  const items = Array.isArray(payload?.items) ? payload.items : []
  return {
    title: payload?.title ?? '正在发酵',
    description: payload?.description ?? '',
    items: items.map((item) => ({
      topic_key: item?.topic_key ?? '',
      title: item?.title ?? item?.topic_key ?? '',
      description: item?.description ?? '',
      cover_image: item?.cover_image ?? '',
      post_count: item?.post_count ?? 0,
      source_count: item?.source_count ?? 0,
      latest_post_at: item?.latest_post_at ?? null,
      avg_quality_score: item?.avg_quality_score ?? null,
      is_featured: Boolean(item?.is_featured),
    })),
  }
}

function normalizeContinueReading(payload = {}) {
  return {
    title: payload?.title ?? '继续追更',
    empty_hint: payload?.empty_hint ?? '',
    local_only: payload?.local_only !== false,
    items: Array.isArray(payload?.items) ? payload.items : [],
  }
}

function normalizeSubscriptionCta(payload = {}) {
  return {
    title: payload?.title ?? '订阅捷径',
    description: payload?.description ?? '',
    feeds_path: payload?.feeds_path ?? '/feeds',
    rss_url: payload?.rss_url ?? '',
    primary_label: payload?.primary_label ?? '打开订阅中心',
    primary_to: payload?.primary_to ?? '/feeds',
    secondary_label: payload?.secondary_label ?? 'RSS',
    secondary_to: payload?.secondary_to ?? payload?.rss_url ?? '',
    email_enabled: Boolean(payload?.email_enabled),
    web_push_enabled: Boolean(payload?.web_push_enabled),
  }
}

export async function fetchHomeModules(requestOptions = {}) {
  const payload = await apiGet('/api/home/modules', requestOptions)
  return {
    hero: normalizeHero(payload?.hero),
    latest_weekly: Array.isArray(payload?.latest_weekly) ? payload.latest_weekly.map((post) => normalizePost(post)) : [],
    latest_daily: Array.isArray(payload?.latest_daily) ? payload.latest_daily.map((post) => normalizePost(post)) : [],
    featured_series: Array.isArray(payload?.featured_series) ? payload.featured_series.map((series) => normalizeSeries(series)) : [],
    topic_pulse: normalizeTopicPulse(payload?.topic_pulse),
    continue_reading: normalizeContinueReading(payload?.continue_reading),
    subscription_cta: normalizeSubscriptionCta(payload?.subscription_cta),
  }
}
