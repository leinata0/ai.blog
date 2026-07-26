import { useEffect, useState, useCallback, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { fetchAdminImages, deleteAdminImage } from '../../api/admin'
import { proxyImageUrl } from '../../utils/proxyImage'
import { useAdminConfirm } from './AdminConfirmDialog'

export default function AdminImages() {
  const confirm = useAdminConfirm()
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Distinguishes "the list request failed" from "no images uploaded yet",
  // so a 500 / expired token never renders as a friendly empty state.
  const [loadFailed, setLoadFailed] = useState(false)
  // AdminDashboardPage lazy-mounts one panel per section, so switching sections
  // unmounts this component while the request is still in flight. Every setState
  // after an await has to be gated on the component still being mounted.
  const activeRef = useRef(true)

  const loadImages = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminImages()
      if (!activeRef.current) return
      setImages(Array.isArray(result) ? result : result?.items || [])
      setLoadFailed(false)
    } catch (err) {
      if (!activeRef.current) return
      setLoadFailed(true)
      setError(err.message || '加载图片失败')
    } finally {
      if (activeRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    activeRef.current = true
    loadImages()
    return () => {
      activeRef.current = false
    }
  }, [loadImages])

  async function handleDelete(filename) {
    const confirmed = await confirm({
      title: '删除图片',
      description: `将永久删除“${filename}”。仍引用它的页面可能显示破损图片。`,
      confirmLabel: '删除图片',
    })
    if (!confirmed || !activeRef.current) return
    try {
      await deleteAdminImage(filename)
      if (!activeRef.current) return
      loadImages()
    } catch (err) {
      if (!activeRef.current) return
      setError(err.message || '删除失败')
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-6 text-[var(--text-primary)]">图片管理</h2>
      {error && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--danger-soft)] px-4 py-2 text-sm text-[var(--danger-text)]">
          <span>{error}</span>
          <button
            type="button"
            onClick={loadImages}
            disabled={loading}
            className="min-h-11 rounded-lg border border-[var(--danger-text)] px-3 text-xs font-medium text-[var(--danger-text)] disabled:opacity-60"
          >
            重试
          </button>
        </div>
      )}
      {loading ? (
        <div role="status" className="text-sm text-[var(--text-faint)]">加载中…</div>
      ) : loadFailed && images.length === 0 ? (
        <div className="text-sm text-[var(--text-faint)]">图片列表加载失败，请点击上方“重试”。</div>
      ) : images.length === 0 ? (
        <div className="text-sm text-[var(--text-faint)]">暂无已上传图片</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {images.map((img) => {
            const filename = typeof img === 'string' ? img : img.filename || img.name
            const url = typeof img === 'string' ? img : img.url || `/api/admin/images/${filename}`
            return (
              <div key={filename} className="rounded-xl overflow-hidden group relative bg-[var(--bg-surface)]"
                style={{ boxShadow: 'var(--card-shadow)' }}>
                <div className="w-full h-36 overflow-hidden">
                  <img src={proxyImageUrl(url)} alt={filename} width="640" height="360" loading="lazy" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                </div>
                <div className="p-3 flex items-center justify-between">
                  <span className="text-xs truncate flex-1 text-[var(--text-tertiary)]">{filename}</span>
                  <button type="button" onClick={() => handleDelete(filename)} className="ml-2 inline-flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center rounded hover:bg-[var(--danger-soft)]" aria-label={`删除图片：${filename}`} title="删除">
                    <Trash2 size={14} className="text-[var(--danger-text)]" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
