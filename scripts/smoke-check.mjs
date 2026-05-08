const requiredEnv = ['PUBLIC_SITE_URL', 'BLOG_API_BASE']

for (const key of requiredEnv) {
  if (!process.env[key]?.trim()) {
    console.error(`[smoke] Missing required env: ${key}`)
    process.exit(1)
  }
}

const publicSiteUrl = process.env.PUBLIC_SITE_URL.replace(/\/$/, '')
const blogApiBase = process.env.BLOG_API_BASE.replace(/\/$/, '')
const adminUsername = process.env.ADMIN_USERNAME?.trim() || ''
const adminPassword = process.env.ADMIN_PASSWORD?.trim() || ''
const includeAdmin = process.env.INCLUDE_ADMIN_SMOKE === '1'

async function expectJson(url, init = {}) {
  const response = await fetch(url, init)
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${url} -> HTTP ${response.status} ${text}`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${url} -> invalid JSON: ${text.slice(0, 200)}`)
  }
}

async function main() {
  const publicChecks = [
    `${publicSiteUrl}/`,
    `${blogApiBase}/api/health`,
    `${blogApiBase}/api/settings`,
    `${blogApiBase}/api/stats`,
    `${blogApiBase}/api/public/home-bootstrap`,
  ]

  for (const url of publicChecks) {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`${url} -> HTTP ${response.status}`)
    }
  }

  if (!includeAdmin) {
    console.log('[smoke] Public checks passed')
    return
  }

  if (!adminUsername || !adminPassword) {
    throw new Error('Admin smoke requested but ADMIN_USERNAME/ADMIN_PASSWORD missing')
  }

  const login = await expectJson(`${blogApiBase}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: adminUsername, password: adminPassword }),
  })

  const token = login.access_token
  if (!token) {
    throw new Error('Admin login succeeded without access token')
  }

  const authHeaders = {
    Authorization: `Bearer ${token}`,
  }

  await expectJson(`${blogApiBase}/api/admin/posts?page_size=1`, { headers: authHeaders })
  await expectJson(`${blogApiBase}/api/admin/cover-generation-status`, { headers: authHeaders })
  await expectJson(`${blogApiBase}/api/admin/ai-channels`, { headers: authHeaders })

  console.log('[smoke] Public + admin checks passed')
}

main().catch((error) => {
  console.error(`[smoke] ${error.message}`)
  process.exit(1)
})
