const {test, expect} = require('@playwright/test');
const {execFileSync} = require('node:child_process');
const path = require('node:path');
const {captureEvidence} = require('/home/kandev/.agents/skills/jlab-dev-v1-implementation/browser-evidence.cjs');

test.use({video: 'on', reducedMotion: 'no-preference'});
test('focused integrated save motion and recovery evidence', async ({page}, testInfo) => {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], {encoding: 'utf8'}).trim());
  const capture = filename => captureEvidence(page, {
    path: testInfo.outputPath(filename), revision, dirty,
    theme: 'dusk', themeSelector: 'meta[name="color-scheme"]', themeAttribute: 'content', themeValue: 'dark',
    viewport: {width: 1366, height: 850},
  });
  await page.goto('/');
  await expect(page.locator('#activity-list > li')).toHaveCount(7);
  await page.getByRole('button', {name: 'Add an evening', exact: true}).click();
  await page.getByRole('textbox', {name: 'Title', exact: true}).fill('A song for the walk home');
  await page.locator('#editor [data-field="mood"] label').filter({hasText: 'Quiet'}).click();
  await page.locator('#editor [data-field="duration"] label').filter({hasText: '30 min'}).click();
  let release;
  const pending = new Promise(resolve => release = resolve);
  await page.route('**/api/activities', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    await pending;
    await route.fulfill({status: 503, contentType: 'application/json', body: '{"error":{"message":"Temporarily unavailable"}}'});
  });
  const field = await page.locator('#field-title').elementHandle();
  await page.getByRole('button', {name: 'Save evening', exact: true}).click();
  await expect(page.locator('#editor-pending')).toContainText('Closing is paused');
  await capture('save-pending.png');
  const pendingBox = await page.locator('#editor').boundingBox();
  release();
  await expect(page.locator('#editor-alert')).toBeFocused();
  await expect(page.locator('#field-title')).toHaveValue('A song for the walk home');
  expect(await field.evaluate(el => el === document.querySelector('#field-title'))).toBe(true);
  const failureBox = await page.locator('#editor').boundingBox();
  expect(Math.abs(pendingBox.x - failureBox.x)).toBeLessThan(1);
  await capture('save-recovery.png');
  await page.unroute('**/api/activities');
  await page.getByRole('button', {name: 'Retry save'}).click();
  await expect(page.locator('#editor')).not.toBeVisible();
  await expect(page.getByRole('button', {name: 'Edit A song for the walk home', exact: true})).toBeFocused();
  await capture('integrated-main.png');
  await testInfo.attach('motion-observation', {body: JSON.stringify({revision, dirty, reducedMotion: 'no-preference',
    actions: 'held POST → failed save → Retry save → committed response',
    result: 'Retained title DOM/draft and loaded list; editor x-position stable; failure focuses alert after unlock; successful retry focuses committed row. Video retained for independent flicker/scroll/transition assessment.'}), contentType: 'application/json'});
});
