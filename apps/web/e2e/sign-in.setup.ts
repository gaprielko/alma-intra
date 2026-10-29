import { expect, test as setup } from '@playwright/test';
import { JANA, SEED_PASSWORD, SEED_TOTP_SECRET, totp } from './totp';

/** Signs Jana in once: e-mail and password, then the six digits; the session is kept. */
setup('sign in', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(JANA);
  await page.getByLabel('Heslo').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Prihlásiť sa' }).click();
  await page.getByLabel('Číslica 1').fill(totp(SEED_TOTP_SECRET));
  await page.getByRole('button', { name: 'Overiť' }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await page.context().storageState({ path: 'e2e/.auth/jana.json' });
});
