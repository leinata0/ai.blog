import { Pencil, Trash2, Plus, Eye, EyeOff, Pin } from 'lucide-react'
import { proxyImageUrl } from '../../utils/proxyImage'
import { formatDate } from '../../utils/date'

export default function AdminPostsList({ posts, onNew, onEdit, onDelete }) {
  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">文章管理</h2>
        <button onClick={onNew}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 bg-[var(--accent)] text-white">
          <Plus size={16} /> 发布新文章
        </button>
      </div>
      <div className="rounded-xl overflow-hidden bg-[var(--bg-surface)]" style={{ boxShadow: 'var(--card-shadow)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-muted)]">
                <th className="text-left px-6 py-3 font-medium text-[var(--text-faint)]">标题</th>
                <th className="text-left px-6 py-3 font-medium text-[var(--text-faint)]">状态</th>
                <th className="text-left px-6 py-3 font-medium text-[var(--text-faint)]">浏览</th>
                <th className="text-left px-6 py-3 font-medium text-[var(--text-faint)]">日期</th>
                <th className="text-left px-6 py-3 font-medium text-[var(--text-faint)]">标签</th>
                <th className="text-right px-6 py-3 font-medium text-[var(--text-faint)]">操作</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.slug || post.id} className="border-b border-[var(--border-muted)]">
                  <td className="px-6 py-4 font-medium text-[var(--text-primary)]">
                    <div className="flex items-center gap-2">
                      {post.cover_image && (
                        <img src={proxyImageUrl(post.cover_image)} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                      )}
                      <span>{post.title}</span>
                      {post.is_pinned && <Pin size={12} className="text-[var(--accent)]" />}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {post.is_published !== false ? (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                        <Eye size={12} /> 已发布
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-[var(--danger-soft)] text-[#ef4444]">
                        <EyeOff size={12} /> 草稿
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-[var(--text-tertiary)]">{post.view_count || 0}</td>
                  <td className="px-6 py-4 text-[var(--text-tertiary)]">{formatDate(post.created_at)}</td>
                  <td className="px-6 py-4">
                    <div className="flex gap-1 flex-wrap">
                      {(post.tags || []).map((t) => (
                        <span key={t.slug} className="px-2 py-0.5 rounded text-xs bg-[var(--accent-soft)] text-[var(--accent)]">{t.name}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button onClick={() => onEdit(post)} className="p-2 rounded-lg transition-colors duration-200 hover:bg-gray-100" title="编辑">
                      <Pencil size={15} className="text-[var(--accent)]" />
                    </button>
                    <button onClick={() => onDelete(post)} className="p-2 rounded-lg transition-colors duration-200 hover:bg-red-50 ml-1" title="删除">
                      <Trash2 size={15} className="text-[#ef4444]" />
                    </button>
                  </td>
                </tr>
              ))}
              {posts.length === 0 && (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-[var(--text-faint)]">暂无文章</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
