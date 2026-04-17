import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  BellRing,
  Compass,
  Newspaper,
  Route,
  Rows3,
  Rss,
} from 'lucide-react'

import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import EditorialSectionHeader from '../components/EditorialSectionHeader'
import SeoMeta from '../components/SeoMeta'
import { useSite } from '../contexts/SiteContext'
import {
  buildBreadcrumbJsonLd,
  buildCollectionPageJsonLd,
  buildWebSiteJsonLd,
} from '../utils/structuredData'
import {
  SITE_COPY,
  motionContainerVariants,
  motionItemVariants,
} from '../utils/contentPresentation'

const START_STEPS = [
  {
    eyebrow: '第一步',
    title: '先读 AI 周报',
    description: '如果你是第一次来，这里最适合先建立全局视角。周报会把一周里最关键的变化串成完整脉络。',
    to: '/weekly',
    label: '先看周报',
    icon: Newspaper,
  },
  {
    eyebrow: '第二步',
    title: '再看 AI 日报',
    description: '当你想跟进每天的变化节奏时，再进入日报流。它更适合高频更新、快速建立当天上下文。',
    to: '/daily',
    label: '进入日报',
    icon: Rows3,
  },
  {
    eyebrow: '第三步',
    title: '按主题持续追踪',
    description: '当你确认自己关心某家公司、模型或产品方向后，主题页会比普通文章列表更适合长期回看。',
    to: '/topics',
    label: '浏览主题',
    icon: Compass,
  },
]

const SUPPORT_LINKS = [
  {
    title: '系列阅读路径',
    description: '想按栏目节奏继续阅读，可以沿系列页进入更明确的阅读路径。',
    to: '/series',
    icon: Route,
  },
  {
    title: '订阅中心',
    description: 'RSS、邮件、浏览器提醒都集中在这里，适合把更新变成稳定回访入口。',
    to: '/feeds',
    icon: Rss,
  },
  {
    title: '追踪页',
    description: '继续阅读、最近关注和最近浏览都在这里，用来快速恢复你刚才看到哪一条主线。',
    to: '/following',
    icon: BellRing,
  },
]

function StartStepCard({ eyebrow, title, description, to, label, icon: Icon }) {
  return (
    <motion.article
      variants={motionItemVariants}
      className="editorial-card rounded-[1.9rem] border px-6 py-6"
      style={{ borderColor: 'var(--border-muted)', backgroundColor: 'var(--bg-surface)' }}
    >
      <div className="section-kicker">{eyebrow}</div>
      <div className="mt-4 inline-flex h-12 w-12 items-center justify-center rounded-[1.1rem]" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}>
        <Icon size={20} />
      </div>
      <h2 className="mt-5 font-display text-[1.8rem] font-semibold tracking-[-0.03em]" style={{ color: 'var(--text-primary)' }}>
        {title}
      </h2>
      <p className="mt-3 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
        {description}
      </p>
      <Link
        to={to}
        className="mt-6 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5"
        style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
      >
        {label}
        <ArrowRight size={14} />
      </Link>
    </motion.article>
  )
}

function SupportCard({ title, description, to, icon: Icon }) {
  return (
    <motion.article
      variants={motionItemVariants}
      className="editorial-card rounded-[1.8rem] border px-5 py-5"
      style={{ borderColor: 'var(--border-muted)', backgroundColor: 'var(--bg-surface)' }}
    >
      <div className="inline-flex h-11 w-11 items-center justify-center rounded-[1rem]" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--accent)' }}>
        <Icon size={18} />
      </div>
      <h3 className="mt-4 font-display text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
        {title}
      </h3>
      <p className="mt-2 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
        {description}
      </p>
      <Link
        to={to}
        className="mt-5 inline-flex items-center gap-2 text-sm font-semibold"
        style={{ color: 'var(--accent)' }}
      >
        打开入口
        <ArrowRight size={14} />
      </Link>
    </motion.article>
  )
}

export default function StartHerePage() {
  const { settings } = useSite()
  const siteUrl = useMemo(() => {
    const configured = String(settings?.site_url || '').trim().replace(/\/$/, '')
    if (configured) return configured
    if (typeof window !== 'undefined') return window.location.origin
    return ''
  }, [settings?.site_url])

  const jsonLd = useMemo(() => ([
    buildWebSiteJsonLd({
      siteUrl,
      name: SITE_COPY.brand,
      description: SITE_COPY.homeSubtitle,
    }),
    buildCollectionPageJsonLd({
      siteUrl,
      name: '开始阅读',
      description: '第一次来到这座 AI 资讯博客时，先读周报、再看日报、再按主题持续追踪。',
      path: '/start-here',
    }),
    buildBreadcrumbJsonLd({
      siteUrl,
      items: [
        { name: '首页', path: '/' },
        { name: '开始阅读', path: '/start-here' },
      ],
    }),
  ]), [siteUrl])

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <SeoMeta
        title="开始阅读 - AI 资讯观察"
        description="第一次来到这座 AI 资讯博客时，先读周报、再看日报、再按主题持续追踪。"
        path="/start-here"
        jsonLd={jsonLd}
      />
      <Navbar />

      <div className="mx-auto max-w-6xl px-6 py-16 sm:px-10">
        <motion.section
          initial="hidden"
          animate="visible"
          variants={motionContainerVariants}
          className="editorial-panel rounded-[2rem] px-8 py-8"
        >
          <motion.div variants={motionItemVariants} className="section-kicker">
            开始阅读
          </motion.div>
          <motion.h1 variants={motionItemVariants} className="section-title max-w-4xl">
            第一次来到这里，先按这条路径进入会更轻松
          </motion.h1>
          <motion.p variants={motionItemVariants} className="section-description max-w-3xl">
            这座站点更像一份持续更新的 AI 资讯杂志。最顺的进入方式不是直接扎进文章流，而是先看周报建立全局，再看日报跟进变化，最后按主题做长期追踪。
          </motion.p>
          <motion.div variants={motionItemVariants} className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/weekly"
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5"
              style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
            >
              从 AI 周报开始
              <ArrowRight size={14} />
            </Link>
            <Link
              to="/feeds"
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5"
              style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
            >
              查看订阅中心
            </Link>
          </motion.div>
        </motion.section>

        <motion.section
          initial="hidden"
          animate="visible"
          variants={motionContainerVariants}
          className="mt-8 grid gap-5 lg:grid-cols-3"
        >
          {START_STEPS.map((step) => (
            <StartStepCard key={step.title} {...step} />
          ))}
        </motion.section>

        <motion.section
          initial="hidden"
          animate="visible"
          variants={motionContainerVariants}
          className="mt-10"
        >
          <EditorialSectionHeader
            eyebrow="辅助入口"
            title="如果你已经知道自己想怎么读，也可以直接从这些入口切入"
            description="系列更强调阅读路径，订阅中心更强调持续回访，追踪页更适合回到你刚才看到哪一条主线。"
          />
          <div className="mt-6 grid gap-5 md:grid-cols-3">
            {SUPPORT_LINKS.map((item) => (
              <SupportCard key={item.title} {...item} />
            ))}
          </div>
        </motion.section>
      </div>

      <Footer />
      <BackToTop />
    </main>
  )
}
