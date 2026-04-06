import { apiGet, apiPost, apiPut, apiDelete } from './client'

export async function adminLogin(username, password) {
  return apiPost('/api/admin/login', { username, password })
}

export const adminCreatePost = (token, data) => apiPost('/api/admin/posts', data, { auth: true })
export const adminUpdatePost = (token, id, data) => apiPut(`/api/admin/posts/${id}`, data, { auth: true })
export const adminDeletePost = (token, id) => apiDelete(`/api/admin/posts/${id}`, { auth: true })

export async function adminUploadImage(token, file) {
  const formData = new FormData()
  formData.append('file', file)
  return apiPost('/api/admin/upload', formData, { auth: true })
}

export const fetchSettings = () => apiGet('/api/settings')
export const updateSettings = (data) => apiPut('/api/settings', data, { auth: true })

export const fetchAdminPosts = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return apiGet(`/api/admin/posts${qs ? '?' + qs : ''}`, { auth: true })
}

export const fetchAdminComments = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return apiGet(`/api/admin/comments${qs ? '?' + qs : ''}`, { auth: true })
}

export const approveComment = (id) => apiPut(`/api/admin/comments/${id}/approve`, {}, { auth: true })
export const deleteComment = (id) => apiDelete(`/api/admin/comments/${id}`, { auth: true })

export const fetchAdminStats = () => apiGet('/api/admin/stats', { auth: true })

export const fetchAdminImages = () => apiGet('/api/admin/images', { auth: true })
export const deleteAdminImage = (filename) => apiDelete(`/api/admin/images/${filename}`, { auth: true })
