import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
          if (
            id.includes('react-markdown')
            || id.includes('remark-gfm')
            || id.includes('react-syntax-highlighter')
          ) {
            return 'vendor-markdown'
          }
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
    environmentMatchGlobs: [
      ['tests/prerender-public.test.js', 'node'],
    ],
  },
})
