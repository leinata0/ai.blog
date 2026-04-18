import { useEffect, useRef, useState } from 'react'
import { Image, Plus, Sparkles, X } from 'lucide-react'

import {
  adminUploadImage,
  fetchAdminCoverGenerationStatus,
  fetchSettings,
  generateAdminHeroImage,
  updateSettings,
} from '../../api/admin'

const EMPTY_SETTINGS = {
  author_name: '',
  bio: '',
  avatar_url: '',
  hero_image: '',
  github_link: '',
  announcement: '',
  site_url: '',
  friend_links: [],
}

function parseFriendLinks(rawLinks) {
  let links = rawLinks || []
  if (typeof links === 'string') {
    try {
      links = JSON.parse(links)
    } catch {
      links = []
    }
  }
  return Array.isArray(links) ? links : []
}

export default function AdminSettings() {
  const [siteSettings, setSiteSettings] = useState(EMPTY_SETTINGS)
  const [saving, setSaving] = useState(false)
  const [assetUploading, setAssetUploading] = useState(false)
  const [heroGenerating, setHeroGenerating] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [coverStatus, setCoverStatus] = useState(null)
  const [heroDiagnostics, setHeroDiagnostics] = useState(null)
  const avatarFileRef = useRef(null)
  const heroFileRef = useRef(null)

  const inputStyle = {
    backgroundColor: 'var(--bg-canvas)',
    border: '1px solid var(--border-muted)',
    color: 'var(--text-primary)',
  }

  useEffect(() => {
    void loadSettings()
    void loadCoverStatus()
  }, [])

  async function loadSettings() {
    try {
      const settings = await fetchSettings()
      setSiteSettings({
        author_name: settings.author_name || '',
        bio: settings.bio || '',
        avatar_url: settings.avatar_url || '',
        hero_image: settings.hero_image || '',
        github_link: settings.github_link || '',
        announcement: settings.announcement || '',
        site_url: settings.site_url || '',
        friend_links: parseFriendLinks(settings.friend_links),
      })
      setError('')
    } catch (err) {
      setError(err.message || '加载站点设置失败')
    }
  }

  async function loadCoverStatus() {
    try {
      const status = await fetchAdminCoverGenerationStatus()
      setCoverStatus(status)
    } catch {
      setCoverStatus(null)
    }
  }

  async function handleSave() {
    setSaving(true)
    setMsg('')
    try {
      const payload = {
        ...siteSettings,
        friend_links: JSON.stringify(siteSettings.friend_links || []),
      }
      const updated = await updateSettings(payload)
      setSiteSettings({
        author_name: updated.author_name || '',
        bio: updated.bio || '',
        avatar_url: updated.avatar_url || '',
        hero_image: updated.hero_image || '',
        github_link: updated.github_link || '',
        announcement: updated.announcement || '',
        site_url: updated.site_url || '',
        friend_links: parseFriendLinks(updated.friend_links),
      })
      setMsg('站点设置已保存')
    } catch (err) {
      setMsg(err.message || '保存站点设置失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleAssetUpload(field, event) {
    const file = event.target.files?.[0]
    if (!file) return

    setAssetUploading(true)
    setMsg('')
    try {
      const { url } = await adminUploadImage(file)
      setSiteSettings((prev) => ({ ...prev, [field]: url }))
      setMsg('图片已上传并写入地址，点击下方“保存站点设置”后会持久生效。')
    } catch (err) {
      setMsg(err.message || '图片上传失败')
    } finally {
      event.target.value = ''
      setAssetUploading(false)
    }
  }

  async function handleGenerateHero() {
    setHeroGenerating(true)
    setMsg('')
    try {
      const result = await generateAdminHeroImage({ overwrite: true })
      setHeroDiagnostics({
        prompt: result?.prompt || '',
        preset: result?.preset || '',
        artDirectionVersion: result?.art_direction_version || '',
        error: result?.error || '',
      })
      if (!result?.generated || !result?.hero_image) {
        setMsg(result?.error || 'Hero 海报生成失败')
        return
      }

      setSiteSettings((prev) => ({
        ...prev,
        hero_image: result.hero_image,
      }))
      setMsg('Hero 海报已生成并直接替换当前首页主海报。')
      await loadCoverStatus()
    } catch (err) {
      setMsg(err.message || 'Hero 海报生成失败')
    } finally {
      setHeroGenerating(false)
    }
  }

  function addFriendLink() {
    setSiteSettings((prev) => ({
      ...prev,
      friend_links: [...(prev.friend_links || []), { name: '', url: '', description: '', avatar: '' }],
    }))
  }

  function removeFriendLink(index) {
    setSiteSettings((prev) => ({
      ...prev,
      friend_links: prev.friend_links.filter((_, itemIndex) => itemIndex !== index),
    }))
  }

  function updateFriendLink(index, field, value) {
    setSiteSettings((prev) => ({
      ...prev,
      friend_links: prev.friend_links.map((item, itemIndex) => (
        itemIndex === index ? { ...item, [field]: value } : item
      )),
    }))
  }

  const isSuccess =
    msg === '站点设置已保存' ||
    msg.includes('图片已上传并写入地址') ||
    msg.includes('Hero 海报已生成并直接替换当前首页主海报')

  return (
    <div
      className="space-y-5 rounded-xl bg-[var(--bg-surface)] p-6 sm:p-8"
      style={{ boxShadow: 'var(--card-shadow)' }}
      data-ui="admin-settings"
    >
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">站点设置</h2>

      {error ? (
        <div className="rounded-lg bg-[var(--danger-soft)] px-4 py-2 text-sm text-[#ef4444]">{error}</div>
      ) : null}

      {msg ? (
        <div
          className="rounded-lg px-4 py-2 text-sm"
          style={{
            backgroundColor: isSuccess ? 'var(--accent-soft)' : 'var(--danger-soft)',
            color: isSuccess ? 'var(--accent)' : '#ef4444',
          }}
        >
          {msg}
        </div>
      ) : null}

      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-secondary)]">博主名称</label>
        <input
          value={siteSettings.author_name}
          onChange={(event) => setSiteSettings((prev) => ({ ...prev, author_name: event.target.value }))}
          className="w-full rounded-lg px-4 py-2.5 text-sm outline-none"
          style={inputStyle}
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-secondary)]">个人简介</label>
        <input
          value={siteSettings.bio}
          onChange={(event) => setSiteSettings((prev) => ({ ...prev, bio: event.target.value }))}
          className="w-full rounded-lg px-4 py-2.5 text-sm outline-none"
          style={inputStyle}
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-secondary)]">站点 URL</label>
        <input
          value={siteSettings.site_url}
          onChange={(event) => setSiteSettings((prev) => ({ ...prev, site_url: event.target.value }))}
          className="w-full rounded-lg px-4 py-2.5 text-sm outline-none"
          style={inputStyle}
          placeholder="https://your-site.example"
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-secondary)]">头像（侧边栏）</label>
        <p className="text-xs leading-relaxed text-[var(--text-faint)]">
          推荐优先上传到本站，避免外链图片因防盗链或图床清理而失效。单张图片最大 10MB。
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={siteSettings.avatar_url}
            onChange={(event) => setSiteSettings((prev) => ({ ...prev, avatar_url: event.target.value }))}
            className="min-w-0 flex-1 rounded-lg px-4 py-2.5 text-sm outline-none"
            style={inputStyle}
            placeholder="https://... 或 /uploads/..."
          />
          <input
            ref={avatarFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => handleAssetUpload('avatar_url', event)}
          />
          <button
            type="button"
            disabled={assetUploading}
            onClick={() => avatarFileRef.current?.click()}
            className="flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[var(--border-muted)] px-4 py-2.5 text-sm font-medium text-[var(--accent)] transition-colors duration-200 disabled:opacity-50"
          >
            <Image size={16} />
            {assetUploading ? '上传中…' : '上传头像'}
          </button>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-[var(--border-muted)] bg-[var(--bg-canvas)] p-4">
        <div className="space-y-1">
          <label className="text-sm font-medium text-[var(--text-secondary)]">首页 Hero 主海报</label>
          <p className="text-xs leading-relaxed text-[var(--text-faint)]">
            前台会直接读取这里的 `hero_image`。建议使用 4:5 竖版海报，右侧舞台会按单张主海报展示。
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={siteSettings.hero_image}
            onChange={(event) => setSiteSettings((prev) => ({ ...prev, hero_image: event.target.value }))}
            className="min-w-0 flex-1 rounded-lg px-4 py-2.5 text-sm outline-none"
            style={inputStyle}
            placeholder="https://... 或 /uploads/..."
          />
          <input
            ref={heroFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => handleAssetUpload('hero_image', event)}
          />
          <button
            type="button"
            disabled={assetUploading}
            onClick={() => heroFileRef.current?.click()}
            className="flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[var(--border-muted)] px-4 py-2.5 text-sm font-medium text-[var(--accent)] transition-colors duration-200 disabled:opacity-50"
          >
            <Image size={16} />
            {assetUploading ? '上传中…' : '上传海报'}
          </button>
          <button
            type="button"
            disabled={heroGenerating}
            onClick={handleGenerateHero}
            className="flex items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white transition-transform duration-200 hover:-translate-y-0.5 disabled:opacity-50"
          >
            <Sparkles size={16} />
            {heroGenerating
              ? '生成中…'
              : siteSettings.hero_image
                ? '重生成 Hero 海报'
                : '生成 Hero 海报'}
          </button>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_15rem]">
          <div
            className="rounded-xl border border-[var(--border-muted)] px-4 py-3 text-sm"
            style={{ backgroundColor: 'var(--bg-surface)' }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
                style={{
                  backgroundColor: coverStatus?.supports_site_hero ? 'var(--accent-soft)' : 'var(--danger-soft)',
                  color: coverStatus?.supports_site_hero ? 'var(--accent)' : '#ef4444',
                }}
              >
                {coverStatus?.supports_site_hero ? '后台生图已就绪' : '后台生图待配置'}
              </span>
              <span className="text-xs text-[var(--text-faint)]">生成后会直接替换当前 Hero 海报</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              {coverStatus?.message || '后台一键生图依赖 Render 后端运行环境中的 XAI_API_KEY。'}
            </p>
            {heroDiagnostics ? (
              <div className="mt-3 rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-3 text-xs leading-6 text-[var(--text-secondary)]">
                <div>Preset：{heroDiagnostics.preset || 'site_hero'}</div>
                <div>Art Direction：{heroDiagnostics.artDirectionVersion || 'unknown'}</div>
                {heroDiagnostics.prompt ? <div>Prompt：{heroDiagnostics.prompt}</div> : null}
                {heroDiagnostics.error ? <div>Last Error：{heroDiagnostics.error}</div> : null}
              </div>
            ) : null}
          </div>

          <div className="overflow-hidden rounded-[1.4rem] border border-[var(--border-muted)] bg-[var(--bg-surface)]">
            {siteSettings.hero_image ? (
              <img
                src={siteSettings.hero_image}
                alt="当前 Hero 海报预览"
                className="aspect-[4/5] h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex aspect-[4/5] items-center justify-center px-6 text-center text-sm text-[var(--text-faint)]">
                暂无 Hero 海报，点击右侧按钮可直接生成并替换。
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-secondary)]">GitHub 链接</label>
        <input
          value={siteSettings.github_link}
          onChange={(event) => setSiteSettings((prev) => ({ ...prev, github_link: event.target.value }))}
          className="w-full rounded-lg px-4 py-2.5 text-sm outline-none"
          style={inputStyle}
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-secondary)]">公告内容</label>
        <textarea
          value={siteSettings.announcement}
          onChange={(event) => setSiteSettings((prev) => ({ ...prev, announcement: event.target.value }))}
          rows={3}
          className="w-full resize-none rounded-lg px-4 py-2.5 text-sm outline-none"
          style={inputStyle}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-[var(--text-secondary)]">友情链接</label>
          <button
            type="button"
            onClick={addFriendLink}
            className="flex items-center gap-1 rounded-lg border border-[var(--border-muted)] px-3 py-1.5 text-xs font-medium text-[var(--accent)] transition-colors duration-200"
          >
            <Plus size={12} />
            添加友链
          </button>
        </div>

        {(siteSettings.friend_links || []).map((link, index) => (
          <div key={index} className="relative rounded-lg border border-[var(--border-muted)] p-4">
            <button
              type="button"
              onClick={() => removeFriendLink(index)}
              className="absolute right-2 top-2 rounded p-1 hover:bg-red-50"
              title="移除"
            >
              <X size={14} className="text-[#ef4444]" />
            </button>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                value={link.name}
                onChange={(event) => updateFriendLink(index, 'name', event.target.value)}
                className="rounded-lg px-3 py-2 text-sm outline-none"
                style={inputStyle}
                placeholder="名称"
              />
              <input
                value={link.url}
                onChange={(event) => updateFriendLink(index, 'url', event.target.value)}
                className="rounded-lg px-3 py-2 text-sm outline-none"
                style={inputStyle}
                placeholder="https://..."
              />
              <input
                value={link.description}
                onChange={(event) => updateFriendLink(index, 'description', event.target.value)}
                className="rounded-lg px-3 py-2 text-sm outline-none"
                style={inputStyle}
                placeholder="描述"
              />
              <input
                value={link.avatar}
                onChange={(event) => updateFriendLink(index, 'avatar', event.target.value)}
                className="rounded-lg px-3 py-2 text-sm outline-none"
                style={inputStyle}
                placeholder="头像 URL"
              />
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg bg-[var(--accent)] px-6 py-2.5 text-sm font-medium text-white transition-all duration-200 disabled:opacity-50"
      >
        {saving ? '保存中…' : '保存站点设置'}
      </button>
    </div>
  )
}
