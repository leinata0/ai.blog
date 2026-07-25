import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

const AdminConfirmContext = createContext(null)

const DEFAULT_REQUEST = {
  title: '确认操作',
  description: '',
  confirmLabel: '确认',
  cancelLabel: '取消',
  tone: 'danger',
}

function normalizeRequest(options) {
  if (typeof options === 'string') {
    return { ...DEFAULT_REQUEST, description: options }
  }
  return { ...DEFAULT_REQUEST, ...(options || {}) }
}

export function AdminConfirmProvider({ children }) {
  const [request, setRequest] = useState(null)
  const resolverRef = useRef(null)
  const triggerRef = useRef(null)
  const dialogRef = useRef(null)
  const cancelRef = useRef(null)

  const close = useCallback((confirmed) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setRequest(null)
    resolve?.(confirmed)
  }, [])

  const confirm = useCallback((options) => {
    resolverRef.current?.(false)
    triggerRef.current = document.activeElement
    setRequest(normalizeRequest(options))
    return new Promise((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  useEffect(() => () => {
    resolverRef.current?.(false)
    resolverRef.current = null
  }, [])

  useEffect(() => {
    if (!request) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cancelRef.current?.focus()

    function getFocusable() {
      return Array.from(dialogRef.current?.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || [])
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(false)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = getFocusable()
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      triggerRef.current?.focus?.()
    }
  }, [close, request])

  return (
    <AdminConfirmContext.Provider value={confirm}>
      {children}
      {request ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-black/55"
            onClick={() => close(false)}
            aria-label="取消并关闭确认对话框"
            tabIndex={-1}
          />
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-confirm-title"
            aria-describedby="admin-confirm-description"
            className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-6 shadow-2xl overscroll-contain"
          >
            <p className="ops-eyebrow">Important action</p>
            <h2 id="admin-confirm-title" className="mt-2 text-xl font-semibold text-[var(--text-primary)]">
              {request.title}
            </h2>
            <p id="admin-confirm-description" className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
              {request.description}
            </p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                ref={cancelRef}
                type="button"
                onClick={() => close(false)}
                className="min-h-11 rounded-lg border border-[var(--border-muted)] px-5 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)]"
              >
                {request.cancelLabel}
              </button>
              <button
                type="button"
                onClick={() => close(true)}
                className={`min-h-11 rounded-lg px-5 text-sm font-semibold text-white ${
                  request.tone === 'danger' ? 'bg-[#dc2626] hover:bg-[#b91c1c]' : 'bg-[var(--accent)]'
                }`}
              >
                {request.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </AdminConfirmContext.Provider>
  )
}

export function useAdminConfirm() {
  const confirm = useContext(AdminConfirmContext)
  if (!confirm) throw new Error('useAdminConfirm must be used within AdminConfirmProvider')
  return confirm
}
