import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Bell, Mail, Radio, Rss } from 'lucide-react'

import EditorialSectionHeader from '../EditorialSectionHeader'
import { motionItemVariants } from '../../utils/contentPresentation'

function CapabilityPill({ icon: Icon, label, active = true }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold"
      style={{
        backgroundColor: active ? 'var(--accent-soft)' : 'var(--bg-canvas)',
        color: active ? 'var(--accent)' : 'var(--text-faint)',
      }}
    >
      <Icon size={13} />
      {label}
    </span>
  )
}

export default function SubscriptionShortcutSection({ module }) {
  return (
    <motion.section variants={motionItemVariants} data-ui="home-subscription-shortcut">
      <div
        className="overflow-hidden rounded-[2rem] border px-6 py-6 sm:px-8 sm:py-8"
        style={{
          background: 'linear-gradient(135deg, rgba(11,26,54,0.96) 0%, rgba(18,60,122,0.92) 46%, rgba(74,192,229,0.82) 100%)',
          borderColor: 'rgba(112, 177, 255, 0.22)',
          boxShadow: '0 26px 60px rgba(11, 26, 54, 0.28)',
        }}
      >
        <EditorialSectionHeader
          eyebrow="订阅捷径"
          title={module?.title || '把回访入口收进一个地方'}
          description={module?.description || '从这里进入订阅中心，少走几步就能把 RSS、邮件和浏览器提醒都配好。'}
          titleClassName="!text-white"
          descriptionClassName="!text-white/75"
          eyebrowClassName="!text-white/65"
        />

        <div className="mt-5 flex flex-wrap gap-2">
          <CapabilityPill icon={Rss} label="RSS" />
          <CapabilityPill icon={Mail} label="邮件提醒" active={module?.email_enabled} />
          <CapabilityPill icon={Bell} label="浏览器提醒" active={module?.web_push_enabled} />
          <CapabilityPill icon={Radio} label="主题订阅" />
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to={module?.primary_to || '/feeds'}
            className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5"
            style={{ backgroundColor: '#ffffff', color: '#0b1a36' }}
          >
            <Bell size={15} />
            {module?.primary_label || '打开订阅中心'}
          </Link>

          <a
            href={module?.secondary_to || module?.rss_url || '/feed.xml'}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5"
            style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.18)' }}
          >
            <Rss size={15} />
            {module?.secondary_label || 'RSS'}
          </a>
        </div>
      </div>
    </motion.section>
  )
}
