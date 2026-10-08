const { test, expect } = require("@playwright/test");
const { installFakeGitHub, createRepo, seedFromTemplate, pageFiles, projectJson } = require("../helpers/fake-github");
const { watch } = require("../helpers/watch");

let w;
test.beforeEach(({ page }) => { w = watch(page); });
test.afterEach(() => w.check());
const links = `See [Certificate lifecycle services](certificate-lifecycle-services.md).

[Published URL](https://www.lamassu.io/research/certificate-lifecycle-services.md)
[Relative path](../certificate-lifecycle-services.md)
[Repository path](projects/services/pages/certificate-lifecycle-services/content.md)
[Section](certificate-lifecycle-services.md#renewal)
[Short wiki URL](#/wiki/certificate-lifecycle-services)
[Missing page](missing-service.md)
[External](https://example.com/certificate-lifecycle-services.md)
[Other site area](https://www.lamassu.io/blog/certificate-lifecycle-services.md)
[PDF](guide.pdf)
[Email](mailto:team@example.com)
[Code example](#example)
`;
async function open(page, hash="#/wiki/general/welcome") {
  await page.addInitScript(() => localStorage.setItem("kb.chg", "0"));
  const repo = seedFromTemplate(createRepo());
  repo.add("Link fixtures", {
    "projects/general/pages/welcome/content.md": links,
    ...pageFiles("services", "overview", {content:"## Overview\n", meta:{title:"Overview"}}),
    ...pageFiles("services", "certificate-lifecycle-services", {content:"## Renewal\n\nService details.\n", meta:{title:"Certificate lifecycle services"}}),
    "projects/services/project.json": projectJson({title:"Services", intro:links, items:[{type:"page", id:"overview", children:[{type:"page", id:"certificate-lifecycle-services"}]}]})
  });
  w.gh = await installFakeGitHub(page, {repo});
  await page.goto("/research/" + hash, {waitUntil:"domcontentloaded"});
  await expect(page.locator("#gate")).toBeHidden();
}
const canonical = "#/wiki/services/overview/certificate-lifecycle-services";

test("local article links include their owning project and full parent path", async ({page}) => {
  await open(page);
  for(const label of ["Certificate lifecycle services","Published URL","Relative path","Repository path","Short wiki URL"]){
    await expect(page.locator("#prose a", {hasText:new RegExp("^"+label+"$")})).toHaveAttribute("href", canonical);
  }
  await expect(page.locator("#prose a", {hasText:"Missing page"})).toHaveAttribute("href", "#/wiki/general/missing-service");
  for(const [label, href] of [["External","https://example.com/certificate-lifecycle-services.md"], ["Other site area","https://www.lamassu.io/blog/certificate-lifecycle-services.md"], ["PDF","guide.pdf"], ["Email","mailto:team@example.com"], ["Code example","#example"]]){
    await expect(page.locator("#prose a", {hasText:new RegExp("^"+label+"$")})).toHaveAttribute("href", href);
  }
  await page.locator("#prose a", {hasText:"Section", exact:true}).click();
  await expect(page).toHaveURL(/#\/wiki\/services\/overview\/certificate-lifecycle-services\?section=renewal$/);
  await expect(page.locator("#prose #s-renewal")).toBeVisible();
  expect(w.gh.unexpected).toEqual([]);
});

test("project introductions and editor previews resolve local links", async ({page}) => {
  await open(page, "#/wiki/services");
  await expect(page.locator("#proj-intro a", {hasText:"Published URL"})).toHaveAttribute("href", canonical);
  await page.goto("/research/#/edit/welcome", {waitUntil:"domcontentloaded"});
  await page.locator("#pvBtn").click();
  await expect(page.locator("#pv-area a", {hasText:"Published URL"})).toHaveAttribute("href", canonical);
});
