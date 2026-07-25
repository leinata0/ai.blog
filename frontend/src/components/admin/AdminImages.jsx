import { useEffect, useState, useCallback } from 'react'
import { Trash2 } from 'lucide-react'
import { fetchAdminImages, deleteAdminImage } from '../../api/admin'
import { proxyImageUrl } from '../../utils/proxyImage'
import { useAdminConfirm } from './AdminConfirmDialog'

export default function AdminImages() {
  const confirm = useAdminConfirm()
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadImages = useCallback(async () => {
    setLoading(true)
    try {
      const result = await fetchAdminImages()
      setImages(Array.isArray(result) ? result : result?.items || [])
    } catch (err) {
      setError(err.message || '加载图片失败')
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadImages() }, [loadImages])

  async function handleDelete(filename) {
    const confirmed = await confirm({
      title: '删除图片',
      description: `将永久删除“${filename}”。仍引用它的页面可能显示破损图片。`,
      confirmLabel: '删除图片',
    })
    if (!confirmed) return
    try { await deleteAdminImage(filename); loadImages() } catch (err) { setError(err.message || '删除失败') }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-6 text-[var(--text-primary)]">图片管理</h2>
      {error && (
        <div role="alert" className="mb-4 text-sm py-2 px-4 rounded-lg bg-[var(--danger-soft)] text-[#ef4444]">{error}</div>
      )}
      {loading ? (
        <div role="status" className="text-sm text-[var(--text-faint)]">加载中…</div>
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
                    <Trash2 size={14} className="text-[#ef4444]" />
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
