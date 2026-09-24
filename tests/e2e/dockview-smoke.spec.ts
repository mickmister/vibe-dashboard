import { expect, test } from 'playwright/test';

test('DockView workbench starts with a live QA craft surface', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Voyage name' }).fill('CI DockView Smoke');
  await page.getByRole('button', { name: 'Create Voyage' }).click();
  await expect(page.getByRole('complementary', { name: 'Voyage navigation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'DockView QA Craft', exact: true })).toBeVisible();
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'DockView QA Craft Agent' })).toBeVisible();
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
  await page.reload();
  await expect(page.frameLocator('iframe').getByRole('heading', { name: 'DockView QA Craft Agent' })).toBeVisible();
});
