// Collects JavaScript errors, CSP violations and unplanned GitHub calls so every test can assert there are none.
const { expect } = require("@playwright/test");

function watch(page) {
  const w = { errors: [], gh: null };
  page.on("pageerror", e => w.errors.push("pageerror: " + e));
  page.on("console", m => { if (/Content Security Policy|violates the following/i.test(m.text())) w.errors.push("csp: " + m.text()); });
  w.check = () => {
    expect(w.errors, "no JavaScript or CSP errors").toEqual([]);
    if (w.gh) expect(w.gh.unexpected, "no unplanned GitHub requests").toEqual([]);
  };
  return w;
}
module.exports = { watch };
