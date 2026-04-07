import { useEffect, useState, useCallback } from 'react'
import { Trash2 } from 'lucide-react'
import { fetchAdminImages, deleteAdminImage } from '../../api/admin'
import { proxyImageUrl } from '../../utils/proxyImage'

export default function AdminImages() {
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
    if (!window.confirm(`确定删除图片 ${filename}？`)) return
    try { await deleteAdminImage(filename); loadImages() } catch (err) { setError(err.message || '删除失败') }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-6 text-[var(--text-primary)]">图片管理</h2>
      {error && (
        <div className="mb-4 text-sm py-2 px-4 rounded-lg bg-[var(--danger-soft)] text-[#ef4444]">{error}</div>
      )}
      {loading ? (
        <div className="text-sm text-[var(--text-faint)]">加载中...</div>
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
                  <img src={proxyImageUrl(url)} alt={filename} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                </div>
                <div className="p-3 flex items-center justify-between">
                  <span className="text-xs truncate flex-1 text-[var(--text-tertiary)]">{filename}</span>
                  <button onClick={() => handleDelete(filename)} className="p-1 rounded hover:bg-red-50 flex-shrink-0 ml-2" title="删除">
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
