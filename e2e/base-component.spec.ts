import { test, expect } from './fixtures.ts';
import { FeatureMap } from '../tests/feature-map.ts';

// A component moved in the DOM (appended to another parent) is disconnected
// and reconnected. It must keep its markup and state, and init() must not
// run again.
test('moving a component keeps its markup and does not run init() again', async ({
  page,
}) => {
  await page.goto(FeatureMap.home.route);
  const nav = page.locator(FeatureMap.shell.navComponent);
  await expect(nav).toBeVisible();

  const result = await page.evaluate(
    ({ navTag, linksSelector }) => {
      const el = document.querySelector(navTag);
      if (!el) return null;
      const before = el.querySelectorAll('*').length;
      const first = el.querySelector(linksSelector);
      if (!(first instanceof HTMLElement)) return null;
      first.dataset.marker = 'kept';
      const holder = document.createElement('div');
      document.body.append(holder);
      holder.append(el); // disconnects, then reconnects
      const afterFirst = el.querySelector(linksSelector);
      return {
        sameElement: afterFirst === first,
        marker:
          afterFirst instanceof HTMLElement
            ? afterFirst.dataset.marker
            : undefined,
        before,
        after: el.querySelectorAll('*').length,
      };
    },
    {
      navTag: FeatureMap.shell.navComponent,
      linksSelector: FeatureMap.shell.navLinks,
    }
  );

  expect(result).not.toBeNull();
  if (result) {
    expect(result).toEqual({
      sameElement: true,
      marker: 'kept',
      before: result.before,
      after: result.before,
    });
  }
});

// Subscriptions to long-lived objects belong in connected(), removed in
// disconnectedCallback(): app-nav does this with the router, so after a move
// it still marks the current page.
test('a moved component re-subscribes in connected(): app-nav still follows the router', async ({
  page,
}) => {
  await page.goto(FeatureMap.home.route);
  await page.evaluate((navTag) => {
    const el = document.querySelector(navTag);
    if (!el || !el.parentElement) return;
    const holder = document.createElement('div');
    el.parentElement.insertBefore(holder, el);
    holder.append(el);
  }, FeatureMap.shell.navComponent);

  const link = page.locator(FeatureMap.shell.navUsersLink);
  await link.click();
  await expect(page).toHaveURL(FeatureMap.users.route);
  await expect(link).toHaveAttribute('aria-current', 'page');
});
