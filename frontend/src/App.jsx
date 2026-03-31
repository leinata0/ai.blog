import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import PostDetailPage from './pages/PostDetailPage'
import AdminLoginPage from './pages/AdminLoginPage'
import AdminDashboardPage from './pages/AdminDashboardPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/posts/:slug" element={<PostDetailPage />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
    </Routes>
  )
}
