import { expect, test } from '@playwright/test';

test('the overview opens after signing in', async ({ page }) => {
  await page.goto('/overview');
  await expect(page.getByRole('heading', { name: 'Prehľad' })).toBeVisible();
  await expect(page.getByText('Zákazníci podľa stavu')).toBeVisible();
});

test('a new contact is created and found in the list', async ({ page }) => {
  const name = `E2E test ${Date.now()}`;
  await page.goto('/customers/new');
  await page.getByLabel('Názov', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Uložiť kontakt' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();

  await page.goto('/customers');
  await page.getByPlaceholder('Názov, IČO, meno alebo e-mail kontaktnej osoby').fill(name);
  await expect(page.getByRole('link', { name })).toBeVisible();
});

test('the activity log names what was just done', async ({ page }) => {
  await page.goto('/settings/activity-log');
  await expect(page.getByText('Nový kontakt').first()).toBeVisible();
});
