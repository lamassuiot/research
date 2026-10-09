const { test, expect } = require('@playwright/test');
const { installFakeGitHub, createRepo, seedFromTemplate, pageFiles } = require('../helpers/fake-github');
const { watch } = require('../helpers/watch');
let w;
test.beforeEach(({ page }) => { w = watch(page); });
test.afterEach(() => w.check());

for (const [ext, source] of [['json', '{"message":"Hello <world>"}'], ['yaml', '# comment\nmessage: Hello <world>\n'], ['yml', 'message: Hello <world>\n']]) {
  test(`${ext}: uploads, downloads, replaces, reads history and embeds`, async ({ page }) => {
    const repo = seedFromTemplate(createRepo());
    repo.add('Add links', pageFiles('general', 'data-links', {content:`[[File:My Data.${ext}|data]]\n\n![[File:My Data.${ext}]]\n`}));
    w.gh = await installFakeGitHub(page, { repo });
    await page.goto('/research/#/files');
    await page.setInputFiles('#up-file', {name:`My Data.${ext}`, mimeType:'text/plain', buffer:Buffer.from(source)});
    await expect(page.locator('#up-name')).toHaveValue(`my-data.${ext}`);
    await page.locator('#up-btn').click();
    await expect(page.locator('#pdfbox code')).toHaveText(JSON.stringify({message:'Hello <world>'}, null, 2));
    expect(Buffer.from(repo.head().files.get(`projects/general/files/my-data.${ext}`)).toString()).toBe(source);
    await page.locator('#pdfbox [data-view="raw"]').click();
    expect(await page.locator('#pdfbox code').textContent()).toBe(source);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#f-dl').click()]);
    expect(download.suggestedFilename()).toBe(`my-data.${ext}`);
    const fs = require('node:fs');
    expect(fs.readFileSync(await download.path(), 'utf8')).toBe(source);
    await page.setInputFiles('#up-file', {name:`replacement.${ext}`, mimeType:'text/plain', buffer:Buffer.from(ext === 'json' ? '{"message":"New"}' : 'message: New\n')});
    await page.locator('#up-btn').click();
    await expect(page.locator('#pdfbox code')).toContainText('New');
    await expect(page.locator('ul.special li')).toHaveCount(2);
    await page.locator('ul.special li').nth(1).locator('a').click();
    await expect(page.locator('.ambox.warn')).toContainText('old version');
    await expect(page.locator('#pdfbox code')).toContainText('Hello <world>');
    await page.goto('/research/#/wiki/general/data-links');
    await expect(page.locator('a.file-link')).toHaveAttribute('href', `#/file/my-data.${ext}`);
    await page.locator('[data-preview]').click();
    await expect(page.locator('.pdf-inline code')).toContainText('New');
    await page.locator('.pdf-inline [data-view="raw"]').click();
    await expect(page.locator('.pdf-inline code')).toContainText('New');
    await page.goto('/research/#/files');
    await expect(page.locator('table.files')).toContainText(`my-data.${ext}`);
  });
}

test('uploads a mixed batch and retains invalid data for raw inspection', async ({ page }) => {
  const repo = seedFromTemplate(createRepo());
  w.gh = await installFakeGitHub(page, {repo});
  await page.goto('/research/#/files');
  await page.setInputFiles('#up-file', [
    {name:'config.json', mimeType:'application/json', buffer:Buffer.from('{invalid')},
    {name:'config.yaml', mimeType:'text/plain', buffer:Buffer.from('enabled: true\n')},
  ]);
  await page.locator('#up-btn').click();
  await expect(page.locator('table.files')).toContainText('config.json');
  await expect(page.locator('table.files')).toContainText('config.yaml');
  await page.locator('table.files a', {hasText:'config.json'}).click();
  await expect(page.locator('#pdfbox [role="alert"]')).toContainText('Could not parse JSON');
  await page.locator('#pdfbox [data-view="raw"]').click();
  await expect(page.locator('#pdfbox code')).toHaveText('{invalid');
});
