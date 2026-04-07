import { Navigate } from 'react-router-dom'
import { getToken, isTokenExpired } from '../api/auth'

export default function ProtectedRoute({ children }) {
  if (!getToken() || isTokenExpired()) {
    return <Navigate to="/admin/login" replace />
  }
  return children
}
