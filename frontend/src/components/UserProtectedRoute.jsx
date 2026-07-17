import { Navigate } from 'react-router-dom'
import { useUser } from '../contexts/UserContext'

export default function UserProtectedRoute({ children }) {
  const { user, loading } = useUser()

  if (loading) {
    return (
      <main
        className="flex min-h-screen items-center justify-center bg-[var(--bg-canvas)]"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="text-center" role="status">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
          <p className="text-sm font-medium text-[var(--text-tertiary)]">正在验证登录状态...</p>
        </div>
      </main>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return children
}
