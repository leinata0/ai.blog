import { Navigate } from 'react-router-dom'
import { getUserToken, isUserTokenExpired } from '../api/userAuth'

export default function UserProtectedRoute({ children }) {
  if (!getUserToken() || isUserTokenExpired()) {
    return <Navigate to="/login" replace />
  }
  return children
}
