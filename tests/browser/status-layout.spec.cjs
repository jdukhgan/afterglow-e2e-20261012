const {test, expect} = require('@playwright/test');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const {captureEvidence} = require('/home/kandev/.agents/skills/jlab-dev-v1-implementation/browser-evidence.cjs');

test.beforeEach(async ({request}) => {
  const {activities} = await (await request.get('/api/activities')).json();
  for (const a of activities) await request.delete(`/api/activities/${a.id}`);
  for (const {id, ...a} of require('../../web/fixtures.json').activities) await request.post('/api/activities', {data: a});
});

for (const width of [390, 320]) test(`status pending retains row position and delays dimming at ${width}px`, async ({page}, testInfo) => {
  await page.setViewportSize({width, height: 844});
  await page.goto('/');
  const rows = page.locator('#activity-list > li');
  await expect(rows).toHaveCount(7);
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.locator('#add-activity').evaluate(el => Number(getComputedStyle(el).opacity))).toBe(1);
  await page.clock.install();
  const first = rows.first();
  const before = (await first.boundingBox()).y;
  let release;
  const held = new Promise(resolve => release = resolve);
  await page.route('**/api/activities/*', async route => { await held; await route.continue(); });
  await first.getByRole('button', {name: 'Planned', exact: true}).click();
  await expect(first.locator('.status-feedback')).toContainText('Saving as planned');
  await page.clock.fastForward(60);
  expect(await page.locator('#add-activity').evaluate(el => Number(getComputedStyle(el).opacity))).toBe(1);
  const during = (await first.boundingBox()).y;
  expect(Math.abs(during - before)).toBeLessThan(1);
  await page.clock.fastForward(900);
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], {encoding: 'utf8'}).trim());
  await captureEvidence(page, {path: testInfo.outputPath(`phone-${width}-status-pending.png`), revision, dirty,
    theme: 'dusk', themeSelector: 'meta[name="color-scheme"]', themeAttribute: 'content', themeValue: 'dark', viewport: {width, height: 844}});
  release();
  await expect(first).toHaveAttribute('data-status', 'planned');
  const after = (await first.boundingBox()).y;
  expect(Math.abs(after - before)).toBeLessThan(1);
  await expect(first.getByRole('button', {name: 'Planned', exact: true})).toBeFocused();
  fs.writeFileSync(testInfo.outputPath('status-layout.json'), JSON.stringify({revision, dirty, width, before, during, after, noEarlyDimming: true}, null, 2));
  await page.unroute('**/api/activities/*');
  await first.getByRole('button', {name: 'Saved', exact: true}).click();
  await expect(first).toHaveAttribute('data-status', 'saved');
});
