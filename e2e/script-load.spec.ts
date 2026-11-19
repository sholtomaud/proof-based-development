import { test, expect } from './fixtures.ts';
import { FeatureMap } from '../tests/feature-map.ts';

// Covers MIME-type and module-load failures, CSP violations and uncaught
// errors, on the home page and on a nested deep link.
for (const path of [
  FeatureMap.home.route,
  FeatureMap.userProfile.routeFor('Ada'),
]) {
  test(`no console, page, or network errors on ${path}`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'networkidle' });
    await expect(page.locator(FeatureMap.shell.routerOutlet)).toBeVisible();
  });
}
