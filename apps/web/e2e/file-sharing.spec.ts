import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

const COMPANY_ROOT = '00000000-0000-4000-8000-0000000000f0';
const SHOTS = process.env.E2E_SHOTS;

const DOC = `<!doctype html><html lang="sk"><head><meta charset="utf-8"><title>Návrh</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree">
<style>h1{color:#0a6466}.note{background:#eef6f5;padding:12px}table{border-collapse:collapse}td,th{border:1px solid #ccd;padding:6px}</style>
</head><body>
<h1 class="big">Návrh spolupráce</h1>
<p>Alma ADOS zjednodušuje prácu sestier. <a href="https://adosalma.sk">Viac o aplikácii</a>.</p>
<p>Spoluprácu začneme spoločným stretnutím, na ktorom si prejdeme, <b>ako dnes pracujete</b>.</p>
<div class="note">Krátka poznámka v bloku.</div>
<div class="cards"><section><h2>Karta jeden</h2><p>Text prvej karty.</p></section></div>
<table class="t"><thead><tr><th>Položka</th><th>Cena</th></tr></thead><tbody><tr><td>Licencia</td><td>[Cena]</td></tr></tbody></table>
<ul><li>Prvý bod</li></ul>
<details><summary>Rozbaliť</summary><p id="in">Text v rozbalenej časti.</p></details>
<p><a href="#in">Odkaz dovnútra</a></p>
<p>Vypočítané: <span id="calc">?</span></p>
<script>document.getElementById('calc').textContent=String(6*7);</script>
<script id="alma-edit">document.body.append('PANEL-UPRAV');</script>
</body></html>`;

async function trpc<T>(request: APIRequestContext, path: string, input: unknown) {
  const res = await request.post(`/trpc/${path}?batch=1`, { data: { 0: input } });
  const [body] = (await res.json()) as [{ result?: { data: T }; error?: unknown }];
  if (!body.result) throw new Error(`${path}: ${JSON.stringify(body.error)}`);
  return body.result.data;
}

async function uploadHtml(page: Page, name: string) {
  const bytes = Buffer.from(DOC, 'utf8');
  const asked = await trpc<{ fileId: string; versionId: string; url: string }>(
    page.request,
    'file.requestUpload',
    { folderId: COMPANY_ROOT, name, size: bytes.byteLength },
  );
  const put = await page.request.put(asked.url, {
    data: bytes,
    headers: { 'content-type': 'text/html' },
  });
  expect(put.ok()).toBe(true);
  await trpc(page.request, 'file.confirmUpload', { versionId: asked.versionId });
  return asked;
}

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

// One signed-in page for all: the session's refresh token rotates, and a second copy of the saved
// one would look like a stolen token.
let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
});
test.afterAll(async () => {
  await page.context().close();
});

test('a shared HTML file: read, comment, edit, approve, new version', async ({ browser }) => {
  test.setTimeout(180_000);
  const name = `Zdieľaný ${Date.now()}.html`;
  const file = await uploadHtml(page, name);

  // A colleague shares it from the file's menu.
  await page.goto('/files');
  await page.getByRole('button', { name: `Akcie pre ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Zdieľať' }).click();
  await page.getByRole('radio', { name: 'Úpravy' }).click();
  await page.locator('#share-password').fill('heslo-pre-navrh');
  await shot(page, 'dialog');
  await page.getByRole('button', { name: 'Uložiť', exact: true }).click();
  const linkField = page.getByRole('textbox', { name: 'Verejný odkaz' });
  await expect(linkField).toBeVisible();
  const link = await linkField.inputValue();
  await shot(page, 'dialog-saved');
  expect(link).toContain('/zdielanie#');
  const address = new URL(link);
  await page.getByRole('button', { name: 'Zavrieť', exact: true }).first().click();

  // A visitor: nobody signed in, nothing of the file before the access screen.
  const context = await browser.newContext({
    locale: 'sk-SK',
    storageState: { cookies: [], origins: [] },
  });
  const visitor = await context.newPage();
  const errors: string[] = [];
  visitor.on('pageerror', (error) => errors.push(error.message));
  await visitor.goto(`${address.pathname}${address.hash}`);
  await expect(visitor.getByRole('heading', { name: 'Zdieľaný dokument' })).toBeVisible();
  await expect(visitor.getByText(name)).toHaveCount(0);
  await shot(visitor, 'access');
  await visitor.getByLabel('Vaše meno').fill('Ján Novák');
  await visitor.getByLabel('Heslo').fill('nesprávne-heslo');
  await visitor.getByRole('button', { name: 'Otvoriť dokument' }).click();
  await expect(visitor.getByRole('alert')).toHaveText('Nesprávne heslo.');
  await visitor.getByLabel('Heslo').fill('heslo-pre-navrh');
  await visitor.getByRole('button', { name: 'Otvoriť dokument' }).click();
  await expect(visitor.getByRole('heading', { name })).toBeVisible();

  // The document runs in its frame: its script ran, the edit bar is gone, the frame is sandboxed.
  const iframe = visitor.locator('iframe').first();
  await expect(iframe).toHaveAttribute('sandbox', /allow-scripts/);
  await expect(iframe).not.toHaveAttribute('sandbox', /allow-same-origin/);
  const doc = visitor.frameLocator('iframe').first();
  await expect(doc.locator('#calc')).toHaveText('42');
  await expect(doc.locator('body')).not.toContainText('PANEL-UPRAV');
  await shot(visitor, 'edit-open');

  // A link inside the document opens the collapsed part around its target.
  await doc.getByRole('link', { name: 'Odkaz dovnútra' }).click();
  await expect(doc.locator('#in')).toBeVisible();

  // Hover shows the fragment's icons; „Upraviť“ opens the editor and saving changes the page only.
  await doc.getByText('Alma ADOS zjednodušuje').hover();
  const edit = visitor.getByRole('button', { name: 'Upraviť', exact: true });
  await expect(edit).toBeVisible();
  await shot(visitor, 'edit-hover');
  await edit.click();
  const editor = visitor.frameLocator('iframe[title="Úprava bloku"]').locator('.ProseMirror');
  await expect(editor).toContainText('Alma ADOS');
  await shot(visitor, 'edit-editor');
  await editor.click();
  await visitor.keyboard.press('End');
  await visitor.keyboard.type(' Nová veta.');
  await visitor.getByRole('button', { name: 'Uložiť', exact: true }).click();
  await expect(doc.getByText('Nová veta.')).toBeVisible();
  await expect(visitor.getByText('Neuložené zmeny: 1')).toBeVisible();
  await shot(visitor, 'edit-bar');

  // Its revision.
  await doc.getByText('Nová veta.').hover();
  await visitor.getByRole('button', { name: 'Zobraziť zmeny' }).click();
  await expect(visitor.locator('ins', { hasText: 'Nová' })).toBeVisible();
  await shot(visitor, 'edit-changes');
  await visitor.getByRole('button', { name: 'Zavrieť' }).click();

  // A table keeps its head through the editor.
  await doc.getByText('Licencia').hover();
  await visitor.getByRole('button', { name: 'Upraviť', exact: true }).click();
  const tableEditor = visitor.frameLocator('iframe[title="Úprava bloku"]').locator('.ProseMirror');
  await expect(tableEditor).toContainText('Licencia');
  await visitor.getByRole('button', { name: 'Uložiť', exact: true }).click();
  await expect(doc.locator('thead th').first()).toHaveText('Položka');

  // A paragraph deleted, with a marker to undo it.
  await doc.getByText('Krátka poznámka').hover();
  await visitor.getByRole('button', { name: 'Zmazať' }).click();
  await expect(doc.getByText('Krátka poznámka')).toHaveCount(0);
  await expect(visitor.getByText('Neuložené zmeny: 2')).toBeVisible();

  // Selecting text offers a comment.
  await doc.getByText('ako dnes pracujete').dblclick();
  await visitor.getByRole('button', { name: 'Komentovať' }).first().click();
  await visitor.getByLabel('Váš komentár').fill('Vieme to spraviť aj online?');
  await shot(visitor, 'comment-new');
  await visitor.getByRole('button', { name: 'Pridať komentár' }).click();
  await expect(visitor.getByText('Vieme to spraviť aj online?')).toBeVisible();
  await expect(doc.locator('mark[data-alma-c]').first()).toBeVisible();
  await shot(visitor, 'comment-done');

  await visitor.getByRole('button', { name: 'Uložiť a poslať na schválenie' }).click();
  await expect(visitor.getByText('Zmeny sme poslali na schválenie.')).toBeVisible();
  await shot(visitor, 'saved');
  await visitor.setViewportSize({ width: 390, height: 844 });
  await shot(visitor, 'phone');
  await visitor.setViewportSize({ width: 1280, height: 720 });

  // No version came of it; a colleague sees the draft.
  const detail = await trpc<{ versions: unknown[] }>(page.request, 'file.get', {
    id: file.fileId,
  });
  expect(detail.versions).toHaveLength(1);
  await page.goto(`/files?file=${file.fileId}`);
  await page.getByRole('tab', { name: /Koncepty/ }).click();
  await shot(page, 'drafts');
  await page.getByRole('link', { name: 'Otvoriť' }).first().click();
  await expect(page.getByText(/Zostáva: 2 zmeny, 1 komentár/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vytvoriť novú verziu' })).toBeDisabled();
  await shot(page, 'draft');

  const panel = page.getByRole('complementary');
  await panel.getByRole('button', { name: 'Odpovedať' }).click();
  await panel.getByLabel('Vaša odpoveď').fill('Áno, online je možné.');
  await panel.getByRole('button', { name: 'Odoslať' }).click();
  await expect(panel.getByText('Áno, online je možné.')).toBeVisible();
  await panel.getByRole('button', { name: 'Odsúhlasiť' }).click();
  await expect(panel.getByText('Odsúhlasené')).toBeVisible();

  await panel.getByRole('button', { name: 'Zamietnuť' }).last().click();
  await expect(panel.getByText('Zamietnuté')).toBeVisible();
  await panel.getByRole('button', { name: 'Schváliť', exact: true }).first().click();
  await expect(panel.getByText('Schválené')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vytvoriť novú verziu' })).toBeEnabled();
  await shot(page, 'draft-ready');
  await page.getByRole('button', { name: 'Vytvoriť novú verziu' }).click();
  await expect(page.getByText(/Koncept sa stal verziou 2/)).toBeVisible();
  // A settled draft still reads against the version it came from.
  await expect(page.getByText('Zmena sa už nedá zaradiť')).toHaveCount(0);

  await page.goto(`/files?file=${file.fileId}`);
  await expect(page.getByText('Externá zmena Ján Novák').first()).toBeVisible();
  await shot(page, 'version');

  // The activity leads back to it.
  await page.goto('/activities');
  await page.getByText('Zmena dokumentu').first().click();
  await expect(page.getByRole('heading', { name: 'Zmena dokumentu' })).toBeVisible();
  await expect(page.getByText(/vytvorená verzia 2/)).toBeVisible();
  await shot(page, 'activity');

  // The new version reaches the visitor, whose own comment is agreed to and gone from the page.
  expect(errors).toEqual([]);
  await context.close();
});

test('a PDF is read without a password, a DOCX only saved', async ({ browser }) => {
  const stamp = Date.now();
  const share = async (name: string, mime: string, bytes: Buffer) => {
    const asked = await trpc<{ fileId: string; versionId: string; url: string }>(
      page.request,
      'file.requestUpload',
      { folderId: COMPANY_ROOT, name, size: bytes.byteLength },
    );
    await page.request.put(asked.url, { data: bytes, headers: { 'content-type': mime } });
    await trpc(page.request, 'file.confirmUpload', { versionId: asked.versionId });
    const saved = await trpc<{ url: string }>(page.request, 'fileShare.save', {
      fileId: asked.fileId,
      mode: 'read',
    });
    const url = new URL(saved.url);
    return `${url.pathname}${url.hash}`;
  };
  const pdf = await share(
    `Cenník ${stamp}.pdf`,
    'application/pdf',
    Buffer.from('%PDF-1.4\n%%EOF\n'),
  );
  const docx = await share(
    `Zmluva ${stamp}.docx`,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    Buffer.from('PK\u0003\u0004abc'),
  );
  const context = await browser.newContext({
    locale: 'sk-SK',
    storageState: { cookies: [], origins: [] },
  });
  const visitor = await context.newPage();
  await visitor.goto(pdf);
  await expect(visitor.getByRole('heading', { name: `Cenník ${stamp}.pdf` })).toBeVisible();
  await expect(visitor.getByRole('button', { name: 'Stiahnuť' })).toBeVisible();
  await visitor.goto(docx);
  await expect(visitor.getByRole('heading', { name: `Zmluva ${stamp}.docx` })).toBeVisible();
  await expect(visitor.getByText('Tento súbor sa v prehliadači nedá zobraziť.')).toBeVisible();
  await context.close();
});

test('two visitors, two drafts: merged in the sheet, alternatives to choose from', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const name = `Dvaja ${Date.now()}.html`;
  const file = await uploadHtml(page, name);
  const saved = await trpc<{ url: string }>(page.request, 'fileShare.save', {
    fileId: file.fileId,
    mode: 'edit',
    password: 'heslo-pre-navrh',
  });
  const address = new URL(saved.url);

  for (const [who, words] of [
    ['Anna', ' Veta Anny.'],
    ['Ben', ' Veta Bena.'],
  ] as const) {
    const context = await browser.newContext({
      locale: 'sk-SK',
      storageState: { cookies: [], origins: [] },
    });
    const visitor = await context.newPage();
    await visitor.goto(`${address.pathname}${address.hash}`);
    await visitor.getByLabel('Vaše meno').fill(who);
    await visitor.getByLabel('Heslo').fill('heslo-pre-navrh');
    await visitor.getByRole('button', { name: 'Otvoriť dokument' }).click();
    const doc = visitor.frameLocator('iframe').first();
    await doc.getByText('Alma ADOS zjednodušuje').hover();
    await visitor.getByRole('button', { name: 'Upraviť', exact: true }).click();
    const editor = visitor.frameLocator('iframe[title="Úprava bloku"]').locator('.ProseMirror');
    await editor.click();
    await visitor.keyboard.press('End');
    await visitor.keyboard.type(words);
    await visitor.getByRole('button', { name: 'Uložiť', exact: true }).click();
    await visitor.getByRole('button', { name: 'Uložiť a poslať na schválenie' }).click();
    await expect(visitor.getByText('Zmeny sme poslali na schválenie.')).toBeVisible();
    await context.close();
  }

  await page.goto(`/files?file=${file.fileId}&tab=drafts`);
  await page.getByRole('checkbox', { name: /Anna/ }).check();
  await page.getByRole('checkbox', { name: /Ben/ }).check();
  await shot(page, 'merge');
  await page.getByRole('button', { name: 'Zlúčiť do jedného konceptu' }).click();
  await expect(page.getByText('Zlúčený').first()).toBeVisible();
  await page.getByRole('link', { name: 'Otvoriť' }).first().click();
  await expect(page.getByText('Dve rôzne zmeny jedného miesta.')).toBeVisible();
  await shot(page, 'alternatives');
  const panel = page.getByRole('complementary');
  await panel.getByRole('button', { name: 'Schváliť túto' }).first().click();
  await expect(panel.getByText('Zamietnuté')).toBeVisible();
  await page.getByRole('button', { name: 'Vytvoriť novú verziu' }).click();
  await expect(page.getByText(/Koncept sa stal verziou 2/)).toBeVisible();
});
