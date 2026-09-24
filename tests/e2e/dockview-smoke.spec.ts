import { expect, test } from 'playwright/test';

test('DockView landing experience starts without fake panel delivery', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Voyage name' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Voyage' })).toBeVisible();
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
  await expect(page.locator('iframe[src*="/internal/dockview-m3-2-harness"]')).toHaveCount(0);
});
