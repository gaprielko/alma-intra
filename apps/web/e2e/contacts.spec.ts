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

test('Organizácie: three tabs, and a filter of several statuses', async ({ page }) => {
  await page.goto('/organizations');
  await expect(page).toHaveURL(/\/organizations\/customers/);
  await page.getByRole('button', { name: 'Stav', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: /Oslovený/ }).click();
  // The menu stays open for the next value.
  await page.getByRole('menuitemcheckbox', { name: /Aktívna spolupráca/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Stav: Oslovený, Aktívna spolupráca')).toBeVisible();
  await page
    .getByRole('link', { name: /Kontakty/ })
    .first()
    .click();
  await expect(page.getByRole('columnheader', { name: /Organizácia a pozícia/i })).toBeVisible();
  await page.getByRole('link', { name: /Partneri/ }).click();
  await expect(page.getByRole('columnheader', { name: /Partner/i })).toBeVisible();
});

test('a person opens from Kontakty with their organizations and own timeline', async ({ page }) => {
  await page.goto('/organizations/contacts?q=T%C3%B3thov%C3%A1');
  await page.getByRole('link', { name: 'Mgr. Eva Tóthová' }).click();
  await expect(page.getByRole('heading', { name: 'Mgr. Eva Tóthová' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Časová os osoby' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'ADOS Harmónia, s.r.o.' }).first()).toBeVisible();
});
