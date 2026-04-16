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
const SearchPage = lazy(() => import('./pages/SearchPage'))
const TopicsPage = lazy(() => import('./pages/TopicsPage'))
const TopicDetailPage = lazy(() => import('./pages/TopicDetailPage'))
const FollowingPage = lazy(() => import('./pages/FollowingPage'))
const ContentTypePage = lazy(() => import('./pages/ContentTypePage'))
const FeedsPage = lazy(() => import('./pages/FeedsPage'))
const TagsPage = lazy(() => import('./pages/TagsPage'))
const FriendsPage = lazy(() => import('./pages/FriendsPage'))
const AdminLoginPage = lazy(() => import('./pages/AdminLoginPage'))
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-canvas)]">
      <div className="text-center">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
        <p className="text-sm font-medium text-[var(--text-tertiary)]">正在整理页面内容...</p>
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
          <Route path="/search" element={<SearchPage />} />
          <Route path="/topics" element={<TopicsPage />} />
          <Route path="/topics/:topicKey" element={<TopicDetailPage />} />
          <Route path="/following" element={<FollowingPage />} />
          <Route path="/daily" element={<ContentTypePage contentType="daily_brief" />} />
          <Route path="/weekly" element={<ContentTypePage contentType="weekly_review" />} />
          <Route path="/feeds" element={<FeedsPage />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route
            path="/admin/dashboard"
            element={
              <ProtectedRoute>
                <AdminDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
