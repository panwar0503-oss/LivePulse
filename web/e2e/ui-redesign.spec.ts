import { expect, test } from '@playwright/test'

const phone = { width: 375, height: 800 }

test.describe('layout at phone width', () => {
  test.use({ viewport: phone })

  for (const path of ['/', '/host', '/join']) {
    test(`${path} has no sideways scroll`, async ({ page }) => {
      await page.goto(path)
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(overflows).toBe(false)
    })
  }
})

test('the page scrollbar is hidden', async ({ page }) => {
  await page.goto('/')
  const scrollbarWidth = await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarWidth)
  expect(scrollbarWidth).toBe('none')
})

test('a presenter creates a session, sees the join details, and opens the room', async ({ page }) => {
  await page.goto('/host')
  await page.getByLabel('Session title').fill('Redesign check')
  await page.getByRole('button', { name: 'Host a session' }).click()

  await expect(page.getByText('Your session is ready')).toBeVisible()
  await expect(page.getByRole('img', { name: 'QR code for the join link' })).toBeVisible()

  await page.getByRole('link', { name: 'Open your room' }).click()
  await expect(page).toHaveURL(/\/host\/[0-9a-f-]{36}$/)
  // The presenter key lives only in the cookie, never in the address.
  expect(page.url()).not.toMatch(/key|token/i)
  await expect(page.getByText('Live', { exact: true }).first()).toBeVisible({ timeout: 15000 })
})
