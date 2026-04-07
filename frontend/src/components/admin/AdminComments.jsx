import { useEffect, useState, useCallback } from 'react'
import { Trash2, Check } from 'lucide-react'
import { fetchAdminComments, approveComment, deleteComment } from '../../api/admin'
import { formatDate } from '../../utils/date'

export default function AdminComments() {
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadComments = useCallback(async () => {
    setLoading(true)
    try {
      const result = await fetchAdminComments()
      setComments(result.items || result || [])
    } catch (err) {
      setError(err.message || '加载评论失败')
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadComments() }, [loadComments])

  async function handleApprove(id) {
    try { await approveComment(id); loadComments() } catch (err) { setError(err.message || '操作失败') }
  }

  async function handleDelete(id) {
    if (!window.confirm('确定删除此评论？')) return
    try { await deleteComment(id); loadComments() } catch (err) { setError(err.message || '删除失败') }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-6 text-[var(--text-primary)]">评论管理</h2>
      {error && (
        <div className="mb-4 text-sm py-2 px-4 rounded-lg bg-[var(--danger-soft)] text-[#ef4444]">{error}</div>
      )}
      <div className="rounded-xl overflow-hidden bg-[var(--bg-surface)]" style={{ boxShadow: 'var(--card-shadow)' }}>
        {loading ? (
          <div className="px-6 py-8 text-center text-[var(--text-faint)]">加载中...</div>
        ) : comments.length === 0 ? (
          <div className="px-6 py-8 text-center text-[var(--text-faint)]">暂无评论</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-muted)]">
                  <th className="text-left px-6 py-3 font-medium text-[var(--text-faint)]">文章</th>
                  <th className="text-left px-6 py-3 font-medium text-[var(--text-faint)]">昵称</th>
                  <th className="text-left px-6 py-3 font-medium text-[var(--text-faint)]">内容</th>
                  <th className="text-left px-6 py-3 font-medium text-[var(--text-faint)]">IP</th>
                  <th className="text-left px-6 py-3 font-medium text-[var(--text-faint)]">状态</th>
                  <th className="text-left px-6 py-3 font-medium text-[var(--text-faint)]">日期</th>
                  <th className="text-right px-6 py-3 font-medium text-[var(--text-faint)]">操作</th>
                </tr>
              </thead>
              <tbody>
                {comments.map((c) => (
                  <tr key={c.id} className="border-b border-[var(--border-muted)]">
                    <td className="px-6 py-4 max-w-[120px] truncate text-[var(--text-primary)]">{c.post_title || c.post_slug || '-'}</td>
                    <td className="px-6 py-4 font-medium text-[var(--accent)]">{c.nickname}</td>
                    <td className="px-6 py-4 max-w-[200px] truncate text-[var(--text-secondary)]">{c.content}</td>
                    <td className="px-6 py-4 text-xs text-[var(--text-faint)]">{c.ip || '-'}</td>
                    <td className="px-6 py-4">
                      {c.is_approved ? (
                        <span className="text-xs px-2 py-1 rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">已审核</span>
                      ) : (
                        <span className="text-xs px-2 py-1 rounded-full bg-[var(--danger-soft)] text-[#ef4444]">待审核</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-[var(--text-tertiary)]">{formatDate(c.created_at)}</td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      <button onClick={() => handleApprove(c.id)} className="p-2 rounded-lg transition-colors duration-200 hover:bg-gray-100" title={c.is_approved ? '取消审核' : '审核通过'}>
                        <Check size={15} className="text-[var(--accent)]" />
                      </button>
                      <button onClick={() => handleDelete(c.id)} className="p-2 rounded-lg transition-colors duration-200 hover:bg-red-50 ml-1" title="删除">
                        <Trash2 size={15} className="text-[#ef4444]" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
