export default function CollectionRefreshNotice({ error, preview, generatedAt, onRetry }) {
  if (!error && !preview) return null
  const timestamp = Date.parse(generatedAt)
  const savedAt = Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : ''
  return <aside role="status" aria-live="polite" style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 90, maxWidth: 'calc(100% - 32px)', padding: '12px 16px', border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-surface, #f5f2eb)', color: 'var(--text-primary, #242724)', boxShadow: '0 4px 20px #0002', fontSize: 13 }}>
    {error ? <>最近载入的内容仍可阅读，更新暂时失败。{' '}<button type="button" onClick={onRetry} style={{ textDecoration: 'underline', minHeight: 36, padding: '0 8px' }}>重试更新</button></>
      : <>正在核对更新，暂显 {savedAt ? `${savedAt} 保存的公开内容` : '上次保存的公开内容（保存时间未知）'}。</>}
  </aside>
}
