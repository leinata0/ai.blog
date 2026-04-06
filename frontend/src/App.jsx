import { Suspense, lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'

const HomePage = lazy(() => import('./pages/HomePage'))
const PostDetailPage = lazy(() => import('./pages/PostDetailPage'))
const ArchivePage = lazy(() => import('./pages/ArchivePage'))
const TagsPage = lazy(() => import('./pages/TagsPage'))
const FriendsPage = lazy(() => import('./pages/FriendsPage'))
const AdminLoginPage = lazy(() => import('./pages/AdminLoginPage'))
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>加载中...</p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/posts/:slug" element={<PostDetailPage />} />
          <Route path="/archive" element={<ArchivePage />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
