import { ChevronLeft, ChevronRight } from 'lucide-react'

export default function Pagination({ page, total, pageSize, onPageChange }) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null

  const pages = []
  const start = Math.max(1, page - 2)
  const end = Math.min(totalPages, page + 2)
  for (let i = start; i <= end; i++) pages.push(i)

  return (
    <div className="flex items-center justify-center gap-2 mt-10">
      <button
        className="pagination-btn"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="上一页"
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>

      {start > 1 && (
        <>
          <button className="pagination-btn" onClick={() => onPageChange(1)} aria-label="第 1 页">1</button>
          {start > 2 && <span style={{ color: 'var(--text-faint)' }}>...</span>}
        </>
      )}

      {pages.map((p) => (
        <button
          key={p}
          className={`pagination-btn ${p === page ? 'pagination-btn--active' : ''}`}
          onClick={() => onPageChange(p)}
          aria-label={`第 ${p} 页`}
          aria-current={p === page ? 'page' : undefined}
        >
          {p}
        </button>
      ))}

      {end < totalPages && (
        <>
          {end < totalPages - 1 && <span style={{ color: 'var(--text-faint)' }}>...</span>}
          <button className="pagination-btn" onClick={() => onPageChange(totalPages)} aria-label={`第 ${totalPages} 页`}>{totalPages}</button>
        </>
      )}

      <button
        className="pagination-btn"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label="下一页"
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
