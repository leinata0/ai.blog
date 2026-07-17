import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  createRoot: vi.fn(),
  hydrateRoot: vi.fn(),
}))

vi.mock('react-dom/client', () => ({
  createRoot: mocks.createRoot,
  hydrateRoot: mocks.hydrateRoot,
}))
vi.mock('../src/App', () => ({ default: () => <div>React app</div> }))
vi.mock('../src/contexts/ThemeContext', () => ({ ThemeProvider: ({ children }) => children }))
vi.mock('../src/contexts/SiteContext', () => ({ SiteProvider: ({ children }) => children }))
vi.mock('../src/contexts/UserContext', () => ({ UserProvider: ({ children }) => children }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  mocks.createRoot.mockReturnValue({ render: mocks.render })
  document.body.innerHTML = '<div id="root"><article>prerendered SEO snapshot</article></div>'
})

describe('application mount', () => {
  it('uses createRoot even when a non-React prerender snapshot exists', async () => {
    const root = document.getElementById('root')

    await import('../src/main')

    expect(root).toHaveTextContent('prerendered SEO snapshot')
    expect(mocks.createRoot).toHaveBeenCalledWith(root)
    expect(mocks.render).toHaveBeenCalledOnce()
    expect(mocks.hydrateRoot).not.toHaveBeenCalled()
  })
})
