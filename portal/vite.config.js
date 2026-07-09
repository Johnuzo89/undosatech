import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
  // Vitest: unit tests only. Playwright owns e2e/ (its test() would otherwise
  // be picked up by Vitest's default spec glob and crash the unit run).
  test: { include: ['src/**/*.{test,spec}.{js,jsx}'] },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('recharts') || id.includes('/d3-') || id.includes('victory-vendor')) return 'recharts'
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'react'
        },
      },
    },
  },
})
