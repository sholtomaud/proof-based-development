// Runs against a build made with `--base /sub/path/` and served from there,
// as on GitHub Pages project sites. URLs here are relative to that base.
import { test, expect } from './fixtures.ts';
import { FeatureMap } from '../tests/feature-map.ts';

test('the app works when served from a sub-path', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator(FeatureMap.home.component)).toBeVisible();

  // In-app links are written without the base; the router adds it.
  await page.locator(FeatureMap.shell.navUsersLink).click();
  await expect(page).toHaveURL(/\/sub\/path\/users$/);

  // Requests made by the app (here the users API) resolve from the base.
  await expect(page.locator(FeatureMap.users.item)).toHaveCount(3);
});

test('nested deep links load under a sub-path', async ({ page }) => {
  await page.goto(`./${FeatureMap.userProfile.routeFor('Ada').slice(1)}`, {
    waitUntil: 'networkidle',
  });
  await expect(page.locator(FeatureMap.userProfile.nameHeading)).toHaveText(
    'Ada'
  );

  // A relative URL requested from a nested page resolves from the base.
  const icon = await page.evaluate(async () => {
    const response = await fetch('favicon.svg');
    await response.text();
    return { url: response.url, type: response.headers.get('content-type') };
  });
  expect(icon.url).toMatch(/\/sub\/path\/favicon\.svg$/);
  expect(icon.type).toContain('image/svg+xml');

  await page.goto(`./${FeatureMap.notFound.unknownRoute.slice(1)}`);
  await expect(page.locator(FeatureMap.notFound.component)).toBeVisible();
});
