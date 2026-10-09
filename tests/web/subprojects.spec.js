const {test, expect} = require('@playwright/test');
const {installFakeGitHub, createRepo, seedFromTemplate, projectJson, pageFiles} = require('../helpers/fake-github');
const {watch} = require('../helpers/watch');
let w;
test.beforeEach(({page}) => { w = watch(page); });
test.afterEach(() => w.check());
const meta = (repo, id) => JSON.parse(repo.head().files.get(`projects/${id}/project.json`));
function fixture(){
  const repo = seedFromTemplate(createRepo());
  repo.add('Hierarchy', {
    'projects/crypto/project.json':projectJson({title:'Crypto', tags:['PQC']}),
    'projects/pqc/project.json':projectJson({title:'PQC', parentProject:'crypto'}),
    'projects/signing/project.json':projectJson({title:'Signing'}),
    'projects/inventory/project.json':projectJson({title:'Inventory', parentProject:'pqc'}),
    ...pageFiles('inventory', 'device-list', {title:'Device list'})
  });
  return repo;
}
async function open(page, repo, hash, opts={}){
  w.gh = await installFakeGitHub(page, {repo, ...opts});
  await page.goto('/research/' + hash);
  await expect(page.locator('#gate')).toBeHidden();
}

test('creates a subproject from its parent and keeps independent tags and contents', async ({page}) => {
  const repo = fixture();
  await open(page, repo, '#/wiki/crypto');
  await page.getByRole('link', {name:'Create subproject', exact:true}).click();
  await expect(page.locator('#np-parent')).toHaveValue('crypto');
  await page.fill('#np-title', 'Protocols');
  await page.locator('#np-btn').click();
  await expect(page).toHaveURL(/#\/wiki\/protocols$/);
  expect(meta(repo, 'protocols')).toMatchObject({parentProject:'crypto', tags:[], items:[]});
  await expect(page.locator('.crumbs')).toContainText('Crypto');
  await expect(page.locator('#sideTree')).toContainText('↑ Crypto');
  await page.goto('/research/#/wiki/crypto');
  await expect(page.locator('.subprojects')).toContainText('Protocols');
  await expect(page.locator('#sideTree')).toContainText('Inventory');
});

test('reparents a project with descendants, preserves URLs and contents, and can return to top level', async ({page}) => {
  const repo = fixture();
  await open(page, repo, '#/wiki/pqc?manage=1');
  await expect(page.locator('#ep-parent option[value="pqc"]')).toHaveCount(0);
  await expect(page.locator('#ep-parent option[value="inventory"]')).toHaveCount(0);
  const before = new Map(repo.head().files);
  await page.selectOption('#ep-parent', 'signing');
  await page.locator('#epf button[type=submit]').click();
  await expect(page).toHaveURL(/#\/wiki\/pqc$/);
  expect(meta(repo, 'pqc').parentProject).toBe('signing');
  for(const [path, content] of before) if(path !== 'projects/pqc/project.json') expect(repo.head().files.get(path)).toEqual(content);
  await page.goto('/research/#/wiki/inventory/device-list');
  await expect(page.locator('.crumbs a')).toHaveText(['Projects', 'Signing', 'PQC', 'Inventory']);
  await expect(page.locator('#prose')).toContainText('Some text');
  await page.goto('/research/#/wiki/pqc?manage=1');
  await page.selectOption('#ep-parent', '');
  await page.locator('#epf button[type=submit]').click();
  await expect(page).toHaveURL(/#\/wiki\/pqc$/);
  expect(meta(repo, 'pqc')).not.toHaveProperty('parentProject');
});

test('cannot delete an empty parent that still has subprojects', async ({page}) => {
  const repo = fixture();
  await open(page, repo, '#/wiki/crypto?manage=1');
  const n = repo.commits.length;
  await page.locator('#ep-del').click();
  await expect(page.locator('#toast')).toContainText('subprojects');
  expect(repo.commits.length).toBe(n);
});

test('rejects a cycle introduced while the editing form was open', async ({page}) => {
  const repo = fixture();
  await open(page, repo, '#/wiki/pqc?manage=1');
  await page.selectOption('#ep-parent', 'signing');
  repo.add('Concurrent move', {'projects/signing/project.json':projectJson({...meta(repo,'signing'), parentProject:'inventory'})});
  const n = repo.commits.length;
  await page.locator('#epf button[type=submit]').click();
  await expect(page.locator('#toast')).toContainText('own ancestor');
  expect(repo.commits.length).toBe(n);
  expect(meta(repo,'pqc').parentProject).toBe('crypto');
});

test('rejects a parent deleted while the create form was open', async ({page}) => {
  const repo = fixture();
  await open(page, repo, '#/projects?new=1&parentProject=signing');
  await page.fill('#np-title', 'Child');
  repo.add('Delete signing', {'projects/signing/project.json':null});
  await page.locator('#np-btn').click();
  await expect(page.locator('#toast')).toContainText('parent project no longer exists');
  expect(repo.head().files.has('projects/child/project.json')).toBe(false);
});

test('readers navigate subprojects without editing controls', async ({page}) => {
  await open(page, fixture(), '#/wiki/crypto', {permission:'read'});
  await expect(page.locator('.subprojects')).toContainText('PQC');
  await expect(page.getByRole('link', {name:'Create subproject', exact:true})).toHaveCount(0);
  await page.locator('.subprojects a.lc-title', {hasText:'PQC'}).click();
  await expect(page).toHaveURL(/#\/wiki\/pqc$/);
  await expect(page.locator('.crumbs')).toContainText('Crypto');
});

test('cannot delete a project if a subproject was added after opening the form', async ({page}) => {
  const repo = fixture();
  await open(page, repo, '#/wiki/signing?manage=1');
  repo.add('Concurrent child', {'projects/new-child/project.json':projectJson({title:'New child', parentProject:'signing'})});
  const n = repo.commits.length;
  page.once('dialog', d => d.accept());
  await page.locator('#ep-del').click();
  await expect(page.locator('#toast')).toContainText('still has subprojects');
  expect(repo.commits.length).toBe(n);
});

test('development store supports creating and detaching subprojects', async ({page}) => {
  await page.goto('/research/index.dev.html#/projects?new=1&parentProject=general');
  await page.fill('#np-title', 'Dev child');
  await page.locator('#np-btn').click();
  await expect(page).toHaveURL(/#\/wiki\/dev-child$/);
  await expect(page.locator('.crumbs')).toContainText('General');
  await page.getByRole('link', {name:'Edit project', exact:true}).click();
  await expect(page.locator('#ep-parent')).toHaveValue('general');
  await page.selectOption('#ep-parent', '');
  await page.locator('#epf button[type=submit]').click();
  await expect(page.locator('.crumbs a')).toHaveText(['Projects', 'Dev child']);
});
