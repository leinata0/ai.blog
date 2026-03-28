import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import PostDetailPage from './pages/PostDetailPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/posts/:slug" element={<PostDetailPage />} />
    </Routes>
  )
}
