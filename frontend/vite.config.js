import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { configDefaults } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/health': 'http://127.0.0.1:8000',
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('framer-motion')) return 'vendor-motion'
          if (id.includes('@uiw/react-md-editor') || id.includes('@uiw/react-markdown-preview')) {
            return 'vendor-md-editor'
          }
          if (
            id.includes('/react/')
            || id.includes('/react-dom/')
            || id.includes('react-router')
            || id.includes('scheduler')
          ) {
            return 'vendor-react'
          }
          if (id.includes('lucide-react')) return 'vendor-icons'
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './tests/setup.js',
    // tests/setup.js raises testing-library's per-`waitFor` budget to 3s for slow CI runners.
    // Vitest's own default cap is 5s, so a test chaining a few `waitFor`s would blow the test
    // timeout before any of them expired — trading a precise "waitFor timed out on <element>"
    // message for a useless "test timed out". Keep this comfortably above the async budget.
    testTimeout: 15000,
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // No `environmentMatchGlobs` here: vitest 3 deprecates it (and vitest 4 removes it),
    // and it was redundant — every node-environment test already declares its own
    // `/** @vitest-environment node */` docblock, which takes precedence over this
    // config anyway. tests/prerender-public.test.js was the only glob listed, while
    // three sibling node tests (deployment-routing, prerender-injection,
    // router-absolute-targets) already relied on the docblock alone. Keeping the
    // docblock as the single mechanism avoids the `test.projects` split, which would
    // otherwise fork setupFiles/testTimeout into two configs for one file.
  },
})
