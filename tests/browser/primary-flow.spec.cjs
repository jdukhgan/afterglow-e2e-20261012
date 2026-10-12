const {test, expect} = require('@playwright/test');
const seed = require('../../web/fixtures.json').activities;
const rows = page => page.locator('#activity-list > li');
const failure = route => route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: {message: 'Temporarily unavailable'}})});
async function draft(page, title = 'A little evening music') {
  await page.getByRole('button', {name: 'Add an evening', exact: true}).click();
  await page.getByRole('textbox', {name: 'Title', exact: true}).fill(title);
  await page.locator('#editor [data-field="mood"] label').filter({hasText: 'Quiet'}).click();
  await page.locator('#editor [data-field="duration"] label').filter({hasText: '30 min'}).click();
}

test.beforeEach(async ({request}) => {
  const data = await (await request.get('/api/activities')).json();
  for (const a of data.activities) await request.delete(`/api/activities/${a.id}`);
  for (const {id, ...a} of seed) await request.post('/api/activities', {data: a});
});

test('real create, edit, status, filter reset, delete and reload persistence', async ({page}) => {
  await page.goto('/');
  await expect(rows(page)).toHaveCount(7);
  await draft(page);
  await page.getByRole('button', {name: 'Save evening', exact: true}).click();
  await expect(page.locator('#editor')).not.toBeVisible();
  await expect(rows(page)).toHaveCount(8);
  const row = rows(page).filter({hasText: 'A little evening music'});
  await expect(row.getByRole('button', {name: 'Edit A little evening music', exact: true})).toBeFocused();
  await row.getByRole('button', {name: 'Planned', exact: true}).click();
  await expect(row).toHaveAttribute('data-status', 'planned');
  await row.getByRole('button', {name: 'Edit A little evening music', exact: true}).click();
  await page.getByRole('textbox', {name: 'Title', exact: true}).fill('One song at dusk');
  await page.getByRole('button', {name: 'Save changes', exact: true}).click();
  await page.reload();
  await expect(rows(page).filter({hasText: 'One song at dusk'})).toHaveAttribute('data-status', 'planned');
  await page.locator('#mood-filter label').filter({hasText: 'Outdoors'}).click();
  await page.locator('#time-filter label').filter({hasText: '30 min'}).click();
  await expect(rows(page)).toHaveCount(1);
  await page.getByRole('button', {name: 'Clear filters'}).click();
  await expect(rows(page)).toHaveCount(8);
  await page.getByRole('button', {name: 'Edit One song at dusk', exact: true}).click();
  await page.getByRole('button', {name: 'Delete', exact: true}).click();
  await page.getByRole('button', {name: 'Delete', exact: true}).click();
  await expect(rows(page)).toHaveCount(7);
  await expect(page.locator('#editor')).not.toBeVisible();
  await page.reload();
  await expect(rows(page)).toHaveCount(7);
});

test('failed delayed save retains DOM, draft, list; unlocks then focuses alert; retry persists', async ({page}) => {
  await page.goto('/');
  await expect(rows(page)).toHaveCount(7);
  await draft(page, '  Keep my draft 🌙  ');
  const field = await page.locator('#field-title').elementHandle();
  let release;
  const held = new Promise(resolve => release = resolve);
  await page.route('**/api/activities', async route => {
    if (route.request().method() === 'POST') { await held; await failure(route); }
    else await route.continue();
  });
  await page.getByRole('button', {name: 'Save evening', exact: true}).click();
  await expect(page.locator('#editor-pending')).toContainText('Closing is paused');
  await expect(page.locator('#field-title')).toHaveJSProperty('readOnly', true);
  await expect(page.locator('#editor input[name="mood"]').first()).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('#editor')).toBeVisible();
  release();
  await expect(page.getByRole('button', {name: 'Retry save'})).toBeVisible();
  await expect(page.locator('#field-title')).toHaveValue('  Keep my draft 🌙  ');
  await expect(page.locator('#field-title')).toHaveJSProperty('readOnly', false);
  await expect(page.locator('#editor-alert')).toBeFocused();
  expect(await field.evaluate(el => el === document.querySelector('#field-title'))).toBe(true);
  await expect(rows(page)).toHaveCount(7);
  await page.unroute('**/api/activities');
  await page.getByRole('button', {name: 'Retry save'}).click();
  await expect(page.locator('#editor')).not.toBeVisible();
  await expect(rows(page)).toHaveCount(8);
  await page.reload();
  await expect(rows(page).filter({hasText: 'Keep my draft 🌙'})).toHaveCount(1);
});

test('status and delete failure preserve loaded data, retry and focus after unlock', async ({page}) => {
  await page.goto('/');
  await expect(rows(page)).toHaveCount(7);
  const row = rows(page).first();
  const height = (await row.boundingBox()).height;
  let release;
  const held = new Promise(resolve => release = resolve);
  await page.route('**/api/activities/*', async route => { await held; await failure(route); });
  await row.getByRole('button', {name: 'Planned', exact: true}).click();
  await expect(row.locator('.status-feedback')).toContainText('Saving as planned');
  await expect(page.locator('#navigation-pending')).toContainText('paused');
  await expect(row.locator('.evening-edit')).toHaveAttribute('aria-disabled', 'true');
  expect(Math.abs((await row.boundingBox()).height - height)).toBeLessThan(1);
  release();
  await expect(row.getByRole('button', {name: 'Retry', exact: true})).toBeVisible();
  await expect(row).toHaveAttribute('data-status', 'saved');
  await expect(row.locator('.evening-edit')).toHaveAttribute('aria-disabled', 'false');
  await page.unroute('**/api/activities/*');
  await row.getByRole('button', {name: 'Retry', exact: true}).click();
  await expect(row).toHaveAttribute('data-status', 'planned');
  await expect(row.getByRole('button', {name: 'Planned', exact: true})).toBeFocused();
  await row.locator('.evening-edit').click();
  await page.getByRole('button', {name: 'Delete', exact: true}).click();
  await page.route('**/api/activities/*', failure);
  await page.getByRole('button', {name: 'Delete', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Retry delete'})).toBeVisible();
  await expect(page.locator('#editor-alert')).toBeFocused();
  await expect(rows(page)).toHaveCount(7);
  await page.unroute('**/api/activities/*');
  await page.getByRole('button', {name: 'Retry delete'}).click();
  await expect(rows(page)).toHaveCount(6);
  await expect(rows(page).first().locator('.evening-edit')).toBeFocused();
});

test('older GET cannot undo committed status; failed refresh retains committed state and notice', async ({page}) => {
  await page.goto('/');
  await expect(rows(page)).toHaveCount(7);
  let release, captured, complete;
  const held = new Promise(resolve => release = resolve);
  const fulfilled = new Promise(resolve => complete = resolve);
  await page.route('**/api/activities?*', async route => {
    captured = await route.fetch();
    await held;
    await route.fulfill({response: captured});
    complete();
  });
  await page.locator('#time-filter label').filter({hasText: '2 hours'}).click();
  await expect.poll(() => Boolean(captured)).toBe(true);
  const row = rows(page).first();
  await row.getByRole('button', {name: 'Planned', exact: true}).click();
  await expect(row).toHaveAttribute('data-status', 'planned');
  release();
  await fulfilled;
  await page.unroute('**/api/activities?*');
  await expect(page.locator('#activity-list')).not.toHaveAttribute('aria-busy', 'true');
  await expect(row).toHaveAttribute('data-status', 'planned');
  await page.clock.install();
  await page.getByRole('button', {name: 'Clear filters'}).click();
  await expect(page.locator('#activity-list')).not.toHaveAttribute('aria-busy', 'true');
  await page.clock.fastForward(4000);
  await page.route('**/api/activities?*', failure);
  await page.locator('#time-filter label').filter({hasText: '2 hours'}).click();
  await expect(page.locator('#toast')).toContainText('Couldn’t refresh');
  await page.clock.fastForward(2000);
  await expect(page.locator('#toast')).toBeVisible();
  await row.locator('.evening-edit').click();
  await expect(page.getByRole('textbox', {name: 'Title', exact: true})).toHaveValue('Blue-hour wander');
  await page.keyboard.press('Escape');
  await expect(row).toHaveAttribute('data-status', 'planned');
});

test('phone keyboard, validation, empty recovery and reduced motion', async ({page, request}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('/');
  await expect(rows(page)).toHaveCount(7);
  await page.getByRole('button', {name: 'Add an evening', exact: true}).click();
  await page.getByRole('button', {name: 'Save evening', exact: true}).click();
  await expect(page.getByRole('textbox', {name: 'Title', exact: true})).toBeFocused();
  await expect(page.locator('#error-title')).toContainText('title');
  await page.getByRole('button', {name: 'Save evening', exact: true}).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', {name: 'Close editor'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: 'Add an evening', exact: true})).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const a of (await (await request.get('/api/activities')).json()).activities) await request.delete(`/api/activities/${a.id}`);
  await page.reload();
  await expect(page.getByText('No evenings saved yet.', {exact: true})).toBeVisible();
  await draft(page, 'Start again');
  await page.getByRole('button', {name: 'Save evening', exact: true}).click();
  await expect(rows(page)).toHaveCount(1);
});
