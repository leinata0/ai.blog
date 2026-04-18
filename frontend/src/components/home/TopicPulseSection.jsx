import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Sparkles } from 'lucide-react'

import EditorialSectionHeader from '../EditorialSectionHeader'
import EmptyStatePanel from '../EmptyStatePanel'
import { formatDate } from '../../utils/date'
import { motionContainerVariants, motionItemVariants, hoverLift } from '../../utils/contentPresentation'

export default function TopicPulseSection({ module, onPrefetchTopic }) {
  const items = Array.isArray(module?.items) ? module.items : []

  return (
    <motion.section variants={motionItemVariants} data-ui="home-topic-pulse" className="space-y-4">
      <EditorialSectionHeader
        eyebrow="主题脉冲"
        title={module?.title || '正在发酵'}
        description={module?.description || '最近持续变热的主题会优先沉淀在这里。'}
        actionLabel="查看全部主题"
        actionTo="/topics"
        actionIcon={ArrowRight}
      />

      {items.length > 0 ? (
        <motion.div variants={motionContainerVariants} className="grid gap-4 xl:grid-cols-3">
          {items.map((item) => (
            <motion.article
              key={item.topic_key}
              variants={motionItemVariants}
              whileHover={hoverLift}
              className="editorial-card rounded-[1.7rem] border px-5 py-5"
            >
              <Link
                to={`/topics/${encodeURIComponent(item.topic_key)}`}
                className="block"
                onMouseEnter={() => onPrefetchTopic?.(item.topic_key)}
                onFocus={() => onPrefetchTopic?.(item.topic_key)}
              >
                <div className="flex items-center justify-between gap-3">
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]"
                    style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    <Sparkles size={12} />
                    主题主线
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    {item.latest_post_at ? formatDate(item.latest_post_at) : '持续更新'}
                  </span>
                </div>

                <h3 className="mt-4 font-display text-[1.55rem] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
                  {item.description}
                </p>

                <div className="mt-5 flex flex-wrap gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
                  <span>{item.post_count || 0} 篇内容</span>
                  {item.source_count ? <span>{item.source_count} 条来源</span> : null}
                  {item.avg_quality_score ? <span>质量均分 {item.avg_quality_score}</span> : null}
                </div>
              </Link>
            </motion.article>
          ))}
        </motion.div>
      ) : (
        <EmptyStatePanel
          title="主题脉冲正在积累"
          description="最近一段时间的热点主题还在沉淀，稍后会优先展示最值得持续回访的主线。"
        />
      )}
    </motion.section>
  )
}
