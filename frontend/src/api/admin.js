export async function adminLogin(username, password) {
  const resp = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!resp.ok) throw new Error('登录失败')
  return resp.json()
}

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

export async function adminCreatePost(token, data) {
  const resp = await fetch('/api/admin/posts', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  })
  if (!resp.ok) throw new Error(`创建失败: ${resp.status}`)
  return resp.json()
}

export async function adminUpdatePost(token, id, data) {
  const resp = await fetch(`/api/admin/posts/${id}`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  })
  if (!resp.ok) throw new Error(`更新失败: ${resp.status}`)
  return resp.json()
}

export async function adminDeletePost(token, id) {
  const resp = await fetch(`/api/admin/posts/${id}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  })
  if (!resp.ok) throw new Error(`删除失败: ${resp.status}`)
  return resp.json()
}

export async function fetchSettings() {
  const resp = await fetch('/api/settings')
  if (!resp.ok) throw new Error(`获取设置失败: ${resp.status}`)
  return resp.json()
}

export async function updateSettings(data) {
  const resp = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!resp.ok) throw new Error(`保存设置失败: ${resp.status}`)
  return resp.json()
}
