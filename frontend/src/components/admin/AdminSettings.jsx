import { useEffect, useRef, useState } from 'react'
import { Plus, X, Image } from 'lucide-react'
import { fetchSettings, updateSettings, adminUploadImage } from '../../api/admin'

export default function AdminSettings() {
  const [siteSettings, setSiteSettings] = useState({
    author_name: '', bio: '', avatar_url: '', hero_image: '', github_link: '', announcement: '', site_url: '', friend_links: [],
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [assetUploading, setAssetUploading] = useState(false)
  const [error, setError] = useState('')
  const avatarFileRef = useRef(null)
  const heroFileRef = useRef(null)

  const inputStyle = {
    backgroundColor: 'var(--bg-canvas)',
    border: '1px solid var(--border-muted)',
    color: 'var(--text-primary)',
  }

  useEffect(() => { loadSettings() }, [])

  async function loadSettings() {
    try {
      const s = await fetchSettings()
      let links = s.friend_links || []
      if (typeof links === 'string') {
        try { links = JSON.parse(links) } catch { links = [] }
      }
      if (!Array.isArray(links)) links = []
      setSiteSettings({
        author_name: s.author_name || '',
        bio: s.bio || '',
        avatar_url: s.avatar_url || '',
        hero_image: s.hero_image || '',
        github_link: s.github_link || '',
        announcement: s.announcement || '',
        site_url: s.site_url || '',
        friend_links: links,
      })
    } catch (err) {
      setError(err.message || '加载设置失败')
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
      let links = updated.friend_links || []
      if (typeof links === 'string') {
        try { links = JSON.parse(links) } catch { links = [] }
      }
      if (!Array.isArray(links)) links = []
      setSiteSettings({
        author_name: updated.author_name || '',
        bio: updated.bio || '',
        avatar_url: updated.avatar_url || '',
        hero_image: updated.hero_image || '',
        github_link: updated.github_link || '',
        announcement: updated.announcement || '',
        site_url: updated.site_url || '',
        friend_links: links,
      })
      setMsg('保存成功')
    } catch (err) {
      setMsg(err.message || '保存失败')
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
      setMsg('图片已上传并写入地址，请点击下方「保存设置」持久化。')
    } catch (err) {
      setMsg(err.message || '图片上传失败')
    } finally {
      event.target.value = ''
      setAssetUploading(false)
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
      friend_links: prev.friend_links.filter((_, i) => i !== index),
    }))
  }

  function updateFriendLink(index, field, value) {
    setSiteSettings((prev) => ({
      ...prev,
      friend_links: prev.friend_links.map((item, i) => i === index ? { ...item, [field]: value } : item),
    }))
  }
  return (
    <div className="rounded-xl p-6 sm:p-8 space-y-5 bg-[var(--bg-surface)]" style={{ boxShadow: 'var(--card-shadow)' }}>
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">站点设置</h2>

      {error && (
        <div className="text-sm py-2 px-4 rounded-lg bg-[var(--danger-soft)] text-[#ef4444]">{error}</div>
      )}
      {msg && (
        <div className="text-sm py-2 px-4 rounded-lg"
          style={{
            backgroundColor: (msg === '保存成功' || msg.includes('图片已上传并写入地址')) ? 'var(--accent-soft)' : 'var(--danger-soft)',
            color: (msg === '保存成功' || msg.includes('图片已上传并写入地址')) ? 'var(--accent)' : '#ef4444',
          }}>
          {msg}
        </div>
      )}

      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-secondary)]">博主名称</label>
        <input value={siteSettings.author_name} onChange={(e) => setSiteSettings({ ...siteSettings, author_name: e.target.value })}
          className="w-full px-4 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-secondary)]">个人简介</label>
        <input value={siteSettings.bio} onChange={(e) => setSiteSettings({ ...siteSettings, bio: e.target.value })}
          className="w-full px-4 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-secondary)]">站点 URL</label>
        <input value={siteSettings.site_url} onChange={(e) => setSiteSettings({ ...siteSettings, site_url: e.target.value })}
          className="w-full px-4 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} placeholder="https://563118077.xyz" />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-secondary)]">头像（侧边栏）</label>
        <p className="text-xs leading-relaxed text-[var(--text-faint)]">
          外链图片链接常因防盗链、图床清理而失效。推荐点击「上传图片」写入本站 <code className="text-[11px]">/uploads/...</code> 路径，稳定可用。
        </p>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <input value={siteSettings.avatar_url} onChange={(e) => setSiteSettings({ ...siteSettings, avatar_url: e.target.value })}
            className="w-full flex-1 px-4 py-2.5 rounded-lg text-sm outline-none min-w-0" style={inputStyle} placeholder="https://... 或 /uploads/..." />
          <input ref={avatarFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleAssetUpload('avatar_url', e)} />
          <button type="button" disabled={assetUploading} onClick={() => avatarFileRef.current?.click()}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors duration-200 disabled:opacity-50 text-[var(--accent)] border border-[var(--border-muted)]">
            <Image size={16} />
            {assetUploading ? '上传中…' : '上传头像'}
          </button>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-secondary)]">Hero 浮动图片（首页顶部）</label>
        <p className="text-xs leading-relaxed text-[var(--text-faint)]">同上，可上传或手动填写 URL；留空则使用头像。</p>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <input value={siteSettings.hero_image} onChange={(e) => setSiteSettings({ ...siteSettings, hero_image: e.target.value })}
            className="w-full flex-1 px-4 py-2.5 rounded-lg text-sm outline-none min-w-0" style={inputStyle} placeholder="https://... 留空则使用头像" />
          <input ref={heroFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleAssetUpload('hero_image', e)} />
          <button type="button" disabled={assetUploading} onClick={() => heroFileRef.current?.click()}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors duration-200 disabled:opacity-50 text-[var(--accent)] border border-[var(--border-muted)]">
            <Image size={16} />
            {assetUploading ? '上传中…' : '上传 Hero 图'}
          </button>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-secondary)]">GitHub 链接</label>
        <input value={siteSettings.github_link} onChange={(e) => setSiteSettings({ ...siteSettings, github_link: e.target.value })}
          className="w-full px-4 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-[var(--text-secondary)]">公告内容</label>
        <textarea value={siteSettings.announcement} onChange={(e) => setSiteSettings({ ...siteSettings, announcement: e.target.value })}
          rows={3} className="w-full px-4 py-2.5 rounded-lg text-sm outline-none resize-none" style={inputStyle} />
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-[var(--text-secondary)]">友情链接</label>
          <button type="button" onClick={addFriendLink}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors duration-200 text-[var(--accent)] border border-[var(--border-muted)]">
            <Plus size={12} /> 添加友链
          </button>
        </div>
        {(siteSettings.friend_links || []).map((link, i) => (
          <div key={i} className="p-4 rounded-lg border border-[var(--border-muted)] relative">
            <button type="button" onClick={() => removeFriendLink(i)}
              className="absolute top-2 right-2 p-1 rounded hover:bg-red-50" title="移除">
              <X size={14} className="text-[#ef4444]" />
            </button>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input value={link.name} onChange={(e) => updateFriendLink(i, 'name', e.target.value)}
                className="px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} placeholder="名称" />
              <input value={link.url} onChange={(e) => updateFriendLink(i, 'url', e.target.value)}
                className="px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} placeholder="https://..." />
              <input value={link.description} onChange={(e) => updateFriendLink(i, 'description', e.target.value)}
                className="px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} placeholder="描述" />
              <input value={link.avatar} onChange={(e) => updateFriendLink(i, 'avatar', e.target.value)}
                className="px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} placeholder="头像 URL" />
            </div>
          </div>
        ))}
      </div>

      <button onClick={handleSave} disabled={saving}
        className="px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 disabled:opacity-50 bg-[var(--accent)] text-white">
        {saving ? '保存中...' : '保存设置'}
      </button>
    </div>
  )
}
