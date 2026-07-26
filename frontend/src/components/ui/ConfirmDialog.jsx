import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'

const ConfirmContext = createContext(null)

const DEFAULT_REQUEST = {
  title: '确认操作',
  description: '',
  confirmLabel: '确认',
  cancelLabel: '取消',
  tone: 'danger',
  verificationText: '',
}

function normalizeRequest(options) {
  if (typeof options === 'string') return { ...DEFAULT_REQUEST, description: options }
  return { ...DEFAULT_REQUEST, ...(options || {}) }
}

export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null)
  const [verification, setVerification] = useState('')
  const resolverRef = useRef(null)
  const triggerRef = useRef(null)
  const dialogRef = useRef(null)
  const cancelRef = useRef(null)
  const verificationRef = useRef(null)
  const titleId = useId()
  const descriptionId = useId()

  const close = useCallback((confirmed) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setRequest(null)
    setVerification('')
    resolve?.(confirmed)
  }, [])

  const confirm = useCallback((options) => {
    resolverRef.current?.(false)
    triggerRef.current = document.activeElement
    setVerification('')
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
    const focusTarget = request.verificationText ? verificationRef.current : cancelRef.current
    focusTarget?.focus()

    function focusableElements() {
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
      const focusable = focusableElements()
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

  const verificationMatches = !request?.verificationText || verification === request.verificationText

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request ? (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-black/60"
            onClick={() => close(false)}
            aria-label="取消并关闭确认对话框"
            tabIndex={-1}
          />
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="relative z-10 w-full max-w-md overscroll-contain rounded-2xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-6 text-[var(--text-primary)] shadow-2xl"
          >
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">Important Action</p>
            <h2 id={titleId} className="mt-2 text-xl font-semibold text-balance">{request.title}</h2>
            <p id={descriptionId} className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{request.description}</p>
            {request.verificationText ? (
              <div className="mt-5">
                <label htmlFor={`${titleId}-verification`} className="text-sm font-semibold text-[var(--text-primary)]">
                  输入“{request.verificationText}”继续
                </label>
                <input
                  ref={verificationRef}
                  id={`${titleId}-verification`}
                  name="confirmation_text"
                  value={verification}
                  onChange={(event) => setVerification(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-2 min-h-11 w-full rounded-xl border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 text-sm outline-none focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)]"
                />
              </div>
            ) : null}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                ref={cancelRef}
                type="button"
                onClick={() => close(false)}
                className="min-h-11 rounded-xl border border-[var(--border-muted)] px-5 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                {request.cancelLabel}
              </button>
              <button
                type="button"
                disabled={!verificationMatches}
                onClick={() => close(true)}
                className={`min-h-11 rounded-xl px-5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 ${
                  request.tone === 'danger' ? 'bg-[#dc2626] hover:bg-[#b91c1c]' : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'
                }`}
              >
                {request.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm must be used within ConfirmProvider')
  return confirm
}
