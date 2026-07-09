import { test, expect } from '@playwright/test'

// White-screen guard. Deploy history shows the portal has white-screened on
// build/env regressions (bundle throws at module load → empty #root). These
// tests fail the build before that reaches production.

test('login screen renders without a JS crash', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))

  await page.goto('/', { waitUntil: 'networkidle' })

  // The unauthenticated shell — stable anchors that only appear if the app mounted.
  await expect(page.getByText('UndosaTech').first()).toBeVisible()
  await expect(page.getByText('Federated Research Platform')).toBeVisible()

  // #root must have real content, not an empty white page.
  const rootChildren = await page.locator('#root > *').count()
  expect(rootChildren).toBeGreaterThan(0)

  // No uncaught exception fired during load (the actual white-screen cause).
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([])
})

test('lazy portal chunk loads after mount', async ({ page }) => {
  // A broken code-split (bad manualChunks, missing chunk) surfaces as a load
  // error only once a lazy import resolves — asserting the network settled with
  // no failed responses catches it.
  const failed = []
  page.on('requestfailed', (r) => failed.push(`${r.method()} ${r.url()}`))
  page.on('response', (r) => { if (r.status() >= 500) failed.push(`${r.status()} ${r.url()}`) })

  await page.goto('/', { waitUntil: 'networkidle' })

  const appAssets = failed.filter((u) => u.includes('/assets/') || u.includes('localhost'))
  expect(appAssets, `failed app requests:\n${appAssets.join('\n')}`).toEqual([])
})
