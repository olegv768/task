import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// base './' so the same build works on Vercel and on GitHub Pages (project sub-path)
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
  },
})
