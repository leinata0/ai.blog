import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  BellRing,
  Compass,
  Code2,
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
  START_HERE_COPY,
  motionContainerVariants,
  motionItemVariants,
} from '../utils/contentPresentation'

const START_STEPS = [
  {
    eyebrow: '第一步',
    title: '先看一个真实项目',
    description: '这座博客本身就是一个开源项目。查看源码、架构说明和提交记录，了解采集、生成、发布与部署如何连接起来。',
    href: 'https://github.com/leinata0/ai.blog',
    label: '查看博客源码',
    icon: Code2,
  },
  {
    eyebrow: '第二步',
    title: '按主题寻找线索',
    description: '从主题页寻找你关心的模型、工具或研究。历史文章用于了解背景，具体功能和结论请结合发布日期与原始来源判断。',
    to: '/topics',
    label: '浏览主题',
    icon: Rows3,
  },
  {
    eyebrow: '第三步',
    title: '回看资讯档案',
    description: '过去的日报和周报按日期保留在归档里。它们记录当时的观察，阅读时请留意时效；后续更新以实际发布为准。',
    to: '/archive',
    label: '打开历史归档',
    icon: Compass,
  },
]

const SUPPORT_LINKS = [
  {
    title: '系列阅读路径',
    description: '沿已有系列查找相关内容，逐步建立自己的阅读路径。',
    to: '/series',
    icon: Route,
  },
  {
    title: '订阅中心',
    description: '通过 RSS 接收实际发布的内容，也可以在订阅中心选择其他提醒方式。',
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

function StartStepCard({ eyebrow, title, description, to, href, label, icon: Icon }) {
  const Action = href ? 'a' : Link
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
      <Action
        {...(href ? { href, target: '_blank', rel: 'noopener noreferrer' } : { to })}
        className="mt-6 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5"
        style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
      >
        {label}
        <ArrowRight size={14} />
      </Action>
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
      description: START_HERE_COPY.description,
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
        description={START_HERE_COPY.description}
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
            {START_HERE_COPY.title}
          </motion.h1>
          <motion.p variants={motionItemVariants} className="section-description max-w-3xl">
            {START_HERE_COPY.description}
          </motion.p>
          <motion.div variants={motionItemVariants} className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/archive"
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5"
              style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
            >
              浏览已有文章
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

        <section className="editorial-panel mt-8 rounded-[2rem] px-8 py-8" aria-labelledby="practice-direction">
          <div className="section-kicker">接下来记录什么</div>
          <h2 id="practice-direction" className="mt-3 font-display text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            一次实验，留下可检查的过程
          </h2>
          <p className="section-description max-w-3xl">
            新的实践记录将围绕一个具体问题展开，交代输入、操作步骤、结果、耗时和失败边界，并尽量附上代码或可复用材料。没有亲手验证的内容会说明来源与限制。
          </p>
          <p className="mt-3 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
            这是一项正在推进的调整。现有资讯仍可查阅，实践案例会在完成后加入，不预设每日更新。
          </p>
        </section>

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
