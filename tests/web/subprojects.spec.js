const {test, expect} = require('@playwright/test');
const {installFakeGitHub, createRepo, seedFromTemplate, projectJson, pageFiles} = require('../helpers/fake-github');
const {watch} = require('../helpers/watch');
let w;
test.beforeEach(({page}) => { w = watch(page); });
test.afterEach(() => w.check());
const projectPath = (repo, id) => [...repo.head().files.keys()].find(p => p.endsWith(`/projects/${id}/project.json`) || p === `projects/${id}/project.json`);
const meta = (repo, id) => JSON.parse(repo.head().files.get(projectPath(repo,id)));
function fixture(){
  const repo = seedFromTemplate(createRepo());
  repo.add('Hierarchy', {
    'projects/crypto/project.json':projectJson({title:'Crypto', tags:['PQC']}),
    'projects/crypto/projects/pqc/project.json':projectJson({title:'PQC', parentProject:'crypto'}),
    'projects/signing/project.json':projectJson({title:'Signing'}),
    'projects/crypto/projects/pqc/projects/inventory/project.json':projectJson({title:'Inventory', parentProject:'pqc'}),
    ...pageFiles('crypto/projects/pqc/projects/inventory', 'device-list', {title:'Device list'})
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
  expect(projectPath(repo,'protocols')).toBe('projects/crypto/projects/protocols/project.json');
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
  for(const [path, content] of before){
    const next=path.replace('projects/crypto/projects/pqc/', 'projects/signing/projects/pqc/');
    if(path !== 'projects/crypto/projects/pqc/project.json') expect(repo.head().files.get(next)).toEqual(content);
    if(next !== path) expect(repo.head().files.has(path)).toBe(false);
  }
  expect(repo.head().files.has('projects/signing/projects/pqc/projects/inventory/pages/device-list/content.md')).toBe(true);
  await page.goto('/research/#/wiki/inventory/device-list');
  await expect(page.locator('.crumbs a')).toHaveText(['Projects', 'Signing', 'PQC', 'Inventory']);
  await expect(page.locator('#prose')).toContainText('Some text');
  await page.goto('/research/#/wiki/pqc?manage=1');
  await page.selectOption('#ep-parent', '');
  await page.locator('#epf button[type=submit]').click();
  await expect(page).toHaveURL(/#\/wiki\/pqc$/);
  expect(meta(repo, 'pqc')).not.toHaveProperty('parentProject');
  expect(projectPath(repo,'pqc')).toBe('projects/pqc/project.json');
  expect(projectPath(repo,'inventory')).toBe('projects/pqc/projects/inventory/project.json');
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
  repo.add('Concurrent move', {'projects/signing/project.json':null, 'projects/crypto/projects/pqc/projects/inventory/projects/signing/project.json':projectJson({...meta(repo,'signing'), parentProject:'inventory'})});
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
  repo.add('Concurrent child', {'projects/signing/projects/new-child/project.json':projectJson({title:'New child', parentProject:'signing'})});
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

test('nested projects infer their parent from folders and support page, link and file writes', async ({page}) => {
  const repo=fixture(), directory='projects/crypto/projects/pqc/projects/inventory';
  const metadata=meta(repo,'inventory'); delete metadata.parentProject;
  repo.add('Use physical parent', {[directory + '/project.json']:JSON.stringify(metadata)});
  await open(page,repo,'#/new?project=inventory');
  await page.fill('#f-title','Nested notes');
  await page.fill('#f-body','## Details\n\nNested body\n');
  await page.locator('#saveBtn').click();
  await expect(page).toHaveURL(/#\/wiki\/inventory\/nested-notes$/);
  expect(repo.head().files.has(directory + '/pages/nested-notes/content.md')).toBe(true);
  await page.goto('/research/#/edit/nested-notes');
  await page.fill('#f-body','## Updated\n'); await page.fill('#f-sum','Update');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#prose')).toContainText('Updated');
  await expect(page.locator('.crumbs a')).toHaveText(['Projects','Crypto','PQC','Inventory']);
  await page.goto('/research/#/files?project=inventory');
  await page.setInputFiles('#up-file',{name:'nested.json',mimeType:'application/json',buffer:Buffer.from('{"enabled":true}')});
  await page.locator('#up-btn').click();
  await expect(page).toHaveURL(/#\/wiki\/inventory$/);
  expect(repo.head().files.has(directory + '/files/nested.json')).toBe(true);
  await page.goto('/research/#/file/nested.json');
  await expect(page.locator('#pdfbox code')).toContainText('true');
  await page.goto('/research/#/links?new=1&project=inventory');
  await page.fill('#l-url','https://example.com/reference');
  await page.fill('#l-title','Nested reference');
  await page.locator('#lf button[type=submit]').click();
  await expect(page).toHaveURL(/#\/wiki\/inventory$/);
  expect([...repo.head().files.keys()].some(p => p.startsWith(directory + '/links/'))).toBe(true);
});

test('moving a project retries concurrent saves and reuses every binary and descendant', async ({page}) => {
  const repo=fixture(), source='projects/crypto/projects/pqc', target='projects/signing/projects/pqc';
  const bytes=Buffer.from([0,255,0,1,2,3]);
  repo.add('Binary attachment',{[source + '/files/raw.pdf']:bytes});
  await open(page,repo,'#/wiki/pqc?manage=1',{raceUploadOnce:true});
  await page.selectOption('#ep-parent','signing');
  await page.locator('#epf button[type=submit]').click();
  await expect(page).toHaveURL(/#\/wiki\/pqc$/);
  expect(w.gh.uploadRaced).toBe(true);
  expect(w.gh.blobUploads || 0).toBe(0);
  expect(repo.head().files.get(target + '/files/raw.pdf')).toEqual(bytes);
  expect(repo.head().files.has(target + '/projects/inventory/pages/device-list/content.md')).toBe(true);
  expect([...repo.head().files.keys()].some(p => p.startsWith(source + '/'))).toBe(false);
  expect(repo.head().files.get('NOTES.md')).toBe('y');
});

test('an open editor cannot recreate the old folder after a concurrent project move', async ({page}) => {
  const repo=fixture(), source='projects/crypto/projects/pqc', dest='projects/signing/projects/pqc';
  await open(page,repo,'#/edit/device-list');
  await page.fill('#f-body','## My pending edit\n'); await page.fill('#f-sum','Pending edit');
  const changes={};
  for(const [p,v] of repo.head().files) if(p.startsWith(source + '/')){ changes[p]=null; changes[p.replace(source,dest)]=v; }
  changes[dest + '/project.json']=projectJson({...meta(repo,'pqc'),parentProject:'signing'});
  repo.add('Concurrent physical move',changes);
  const n=repo.commits.length;
  await page.locator('#saveBtn').click();
  await expect(page.locator('#toast')).toContainText('Reload before saving');
  expect(repo.commits.length).toBe(n);
  expect([...repo.head().files.keys()].some(p => p.startsWith(source + '/'))).toBe(false);
  await expect(page.locator('#f-body')).toHaveValue('## My pending edit\n');
});
