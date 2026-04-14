import { Suspense, lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import ProtectedRoute from './components/ProtectedRoute'

const HomePage = lazy(() => import('./pages/HomePage'))
const PostDetailPage = lazy(() => import('./pages/PostDetailPage'))
const ArchivePage = lazy(() => import('./pages/ArchivePage'))
const SeriesPage = lazy(() => import('./pages/SeriesPage'))
const SeriesDetailPage = lazy(() => import('./pages/SeriesDetailPage'))
const DiscoverPage = lazy(() => import('./pages/DiscoverPage'))
const ContentTypePage = lazy(() => import('./pages/ContentTypePage'))
const TagsPage = lazy(() => import('./pages/TagsPage'))
const FriendsPage = lazy(() => import('./pages/FriendsPage'))
const AdminLoginPage = lazy(() => import('./pages/AdminLoginPage'))
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-canvas)]">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-[var(--text-tertiary)]">加载中...</p>
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
          <Route path="/series" element={<SeriesPage />} />
          <Route path="/series/:slug" element={<SeriesDetailPage />} />
          <Route path="/discover" element={<DiscoverPage />} />
          <Route path="/daily" element={<ContentTypePage contentType="daily_brief" />} />
          <Route path="/weekly" element={<ContentTypePage contentType="weekly_review" />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/admin/dashboard" element={<ProtectedRoute><AdminDashboardPage /></ProtectedRoute>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
