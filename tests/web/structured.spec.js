const { test, expect } = require('@playwright/test');
const { installFakeGitHub, createRepo, seedFromTemplate, pageFiles } = require('../helpers/fake-github');
const { watch } = require('../helpers/watch');

let w;
test.beforeEach(({ page }) => { w = watch(page); });
test.afterEach(() => w.check());

for (const [format, source, value] of [
  ['json', '{"enabled":true,"items":[1,null],"html":"<img src=x onerror=alert(1)>"}', { enabled:true, items:[1,null], html:'<img src=x onerror=alert(1)>' }],
  ['yaml', '# Keep this comment\nenabled: true\nitems:\n  - 1\n  - null\nmessage: |\n  Hello\n  world\n', { enabled:true, items:[1,null], message:'Hello\nworld\n' }],
  ['yml', 'defaults: &defaults\n  port: 443\ncopy: *defaults\n', { defaults:{port:443}, copy:{port:443} }],
]) {
  test(`${format}: import, preview, save, reload, source download and format conversion`, async ({ page }) => {
    const repo = seedFromTemplate(createRepo());
    w.gh = await installFakeGitHub(page, { repo });
    await page.goto('/research/#/new');
    await page.locator('#f-file').setInputFiles({ name:`Data.${format}`, mimeType:'text/plain', buffer:Buffer.from(source) });
    await expect(page.locator('#f-body')).toHaveValue(source);
    await page.fill('#f-title', 'Data');
    await page.locator('#pvBtn').click();
    await expect(page.locator('#pv-data code')).toHaveText(JSON.stringify(value, null, 2));
    await page.locator('#pv-data [data-view="raw"]').click();
    expect(await page.locator('#pv-data code').textContent()).toBe(source);
    await page.locator('#saveBtn').click();
    await expect(page.locator('#data-view code')).toHaveText(JSON.stringify(value, null, 2));
    expect(repo.head().files.get(`projects/general/pages/data/content.${format}`)).toBe(source);
    await page.reload();
    await page.locator('#data-view [data-view="raw"]').click();
    expect(await page.locator('#data-view code').textContent()).toBe(source);
    await expect(page.locator('#data-view img')).toHaveCount(0);
    await page.locator('#data-view [data-view="parsed"]').click();
    await expect(page.locator('#data-view [data-view="parsed"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.tabs details').last().locator('summary').click();
    const download = page.waitForEvent('download');
    await page.locator('[data-act="source"]').click();
    expect((await download).suggestedFilename()).toBe(`data.r1.${format}`);
    await page.goto('/research/#/edit/data');
    await expect(page.locator('#f-body')).toHaveValue(source);
    await page.locator('[data-f="md"]').click();
    await page.fill('#f-body', '## Converted\n');
    await page.fill('#f-sum', 'Convert format');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#prose')).toContainText('Converted');
    expect(repo.head().files.has(`projects/general/pages/data/content.${format}`)).toBe(false);
    await page.goto(`/research/#/wiki/general/data?rev=${repo.history('projects/general/pages/data')[1].oid}`);
    await expect(page.locator('#data-view code')).toHaveText(JSON.stringify(value, null, 2));
  });
}

for (const [format, content] of [['json', '{broken'], ['yaml', 'items: [broken']]) {
  test(`${format}: invalid input retains an accessible raw view`, async ({ page }) => {
    const repo = seedFromTemplate(createRepo());
    repo.add('Add invalid data', pageFiles('general', 'bad-data', { format, content }));
    w.gh = await installFakeGitHub(page, { repo });
    await page.goto('/research/#/wiki/general/bad-data');
    await expect(page.locator('#data-view [role="alert"]')).toContainText(`Could not parse ${format.toUpperCase()}`);
    await page.locator('#data-view [data-view="raw"]').click();
    expect(await page.locator('#data-view code').textContent()).toBe(content);
  });
}

test('YAML supports multiple documents and recursive aliases', async ({ page }) => {
  const repo = seedFromTemplate(createRepo());
  repo.add('Add YAML stream', pageFiles('general', 'stream', { format:'yaml', content:'---\nroot: &root\n  self: *root\n---\nfalse\n' }));
  w.gh = await installFakeGitHub(page, { repo });
  await page.goto('/research/#/wiki/general/stream');
  await expect(page.locator('#data-view code')).toHaveText(JSON.stringify([{root:{self:'[Circular reference]'}}, false], null, 2));
});
