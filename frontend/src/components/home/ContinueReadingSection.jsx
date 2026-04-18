import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, History } from 'lucide-react'

import EditorialSectionHeader from '../EditorialSectionHeader'
import EmptyStatePanel from '../EmptyStatePanel'
import { formatDate } from '../../utils/date'
import { getContentTypeMeta, hoverLift, motionContainerVariants, motionItemVariants } from '../../utils/contentPresentation'

export default function ContinueReadingSection({ module, items, onPrefetch }) {
  const readingItems = Array.isArray(items) ? items : []

  return (
    <motion.section variants={motionItemVariants} data-ui="home-continue-reading" className="space-y-4">
      <EditorialSectionHeader
        eyebrow="回访入口"
        title={module?.title || '继续追更'}
        description="直接从你最近读过的内容继续往下看，不必重新找回上下文。"
        actionLabel="查看追踪页"
        actionTo="/following"
        actionIcon={ArrowRight}
      />

      {readingItems.length > 0 ? (
        <motion.div variants={motionContainerVariants} className="grid gap-4 lg:grid-cols-2">
          {readingItems.map((item) => {
            const contentMeta = getContentTypeMeta(item.content_type)
            return (
              <motion.article
                key={item.slug}
                variants={motionItemVariants}
                whileHover={hoverLift}
                className="editorial-card rounded-[1.7rem] border px-5 py-5"
              >
                <Link
                  to={`/posts/${item.slug}`}
                  className="block"
                  onMouseEnter={() => onPrefetch?.(item.slug)}
                  onFocus={() => onPrefetch?.(item.slug)}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
                    <span className="inline-flex items-center gap-1">
                      <History size={12} />
                      最近读过
                    </span>
                    {contentMeta ? <span>{contentMeta.label}</span> : null}
                    <span>{item.coverage_date || formatDate(item.visited_at)}</span>
                  </div>

                  <h3 className="mt-4 font-display text-[1.45rem] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>
                    {item.title}
                  </h3>
                  <p className="mt-3 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
                    {item.summary || '继续沿着这条阅读路径恢复上下文。'}
                  </p>

                  {item.topic_display_title ? (
                    <div className="mt-4 text-xs font-medium" style={{ color: 'var(--accent)' }}>
                      {item.topic_display_title}
                    </div>
                  ) : null}
                </Link>
              </motion.article>
            )
          })}
        </motion.div>
      ) : (
        <EmptyStatePanel
          title="继续追更会出现在这里"
          description={module?.empty_hint || '当你开始阅读文章后，这里会自动出现可继续回访的入口。'}
        />
      )}
    </motion.section>
  )
}
