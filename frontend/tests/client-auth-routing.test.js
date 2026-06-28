import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// client.js imports './auth' and './userAuth'; mock both token stores.
const mocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  clearToken: vi.fn(),
  getUserToken: vi.fn(),
  clearUserToken: vi.fn(),
}))

vi.mock('../src/api/auth', () => ({
  getToken: mocks.getToken,
  clearToken: mocks.clearToken,
}))
vi.mock('../src/api/userAuth', () => ({
  getUserToken: mocks.getUserToken,
  clearUserToken: mocks.clearUserToken,
}))
vi.mock('../src/api/base', () => ({
  resolveApiBase: () => '',
  buildApiUrl: (p) => p,
}))

let apiGet
let apiPost

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  // jsdom navigation guard
  delete window.location
  window.location = { href: '' }
  ;({ apiGet, apiPost } = await import('../src/api/client'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function mockFetch(status, body = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  })))
}

describe('client auth routing', () => {
  it('user 401 clears the user token and does NOT redirect to /admin/login', async () => {
    mocks.getUserToken.mockReturnValue('user-token')
    mockFetch(401, { detail: 'expired' })

    await expect(apiPost('/api/users/me/topics', {}, { auth: 'user' })).rejects.toThrow()
    expect(mocks.clearUserToken).toHaveBeenCalled()
    expect(mocks.clearToken).not.toHaveBeenCalled()
    expect(window.location.href).toBe('')
  })

  it('admin 401 clears admin token and redirects to /admin/login', async () => {
    mocks.getToken.mockReturnValue('admin-token')
    mockFetch(401, { detail: 'expired' })

    await expect(apiPost('/api/admin/something', {}, { auth: 'admin' })).rejects.toThrow()
    expect(mocks.clearToken).toHaveBeenCalled()
    expect(mocks.clearUserToken).not.toHaveBeenCalled()
    expect(window.location.href).toBe('/admin/login')
  })

  it('injects the user token for auth:user requests', async () => {
    mocks.getUserToken.mockReturnValue('user-token')
    const fetchSpy = vi.fn(async () => ({
      ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '{}',
    }))
    vi.stubGlobal('fetch', fetchSpy)

    await apiGet('/api/users/me', { auth: 'user', cache: false })
    const headers = fetchSpy.mock.calls[0][1].headers
    expect(headers.Authorization).toBe('Bearer user-token')
  })
})
