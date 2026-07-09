import { defineConfig, devices } from '@playwright/test'

// Smoke-test config: build the portal with placeholder Supabase env (so the
// client constructs and the app mounts instead of white-screening), serve the
// production build, and drive it with a real browser. Catches the JS-crash /
// white-screen regressions that unit tests can't see.
const PORT = 4173

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Placeholder values — the login screen renders without any network call;
      // OAuth only fires on click, which the smoke test never triggers.
      VITE_SUPABASE_URL: 'https://placeholder.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'placeholder-anon-key',
    },
  },
})
