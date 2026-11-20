import { test, expect } from './fixtures.ts';
import { FeatureMap } from '../tests/feature-map.ts';

test('has title', async ({ page }) => {
  await page.goto(FeatureMap.home.route);
  await expect(page).toHaveTitle(/Boba App/);
  await expect(page.locator(FeatureMap.home.heading)).toBeVisible();
});

test('nav links navigate without reloading and mark the current page', async ({
  page,
}) => {
  await page.goto(FeatureMap.home.route);
  await page.evaluate(() => {
    Reflect.set(window, 'stillSamePage', true);
  });

  const destinations = [
    {
      selector: FeatureMap.shell.navProofsLink,
      path: FeatureMap.proofs.route,
      tag: FeatureMap.proofs.component,
    },
    {
      selector: FeatureMap.shell.navTodoLink,
      path: FeatureMap.todo.route,
      tag: FeatureMap.todo.component,
    },
    {
      selector: FeatureMap.shell.navUsersLink,
      path: FeatureMap.users.route,
      tag: FeatureMap.users.component,
    },
  ] as const;

  for (const { selector, path, tag } of destinations) {
    const link = page.locator(selector);
    await link.click();
    await expect(page).toHaveURL(path);
    await expect(
      page.locator(`${FeatureMap.shell.routerOutlet} > ${tag}`)
    ).toBeVisible();
    await expect(link).toHaveAttribute('aria-current', 'page');
  }

  expect(await page.evaluate(() => Reflect.get(window, 'stillSamePage'))).toBe(
    true
  );

  await page.goBack();
  await expect(
    page.locator(
      `${FeatureMap.shell.routerOutlet} > ${FeatureMap.todo.component}`
    )
  ).toBeVisible();
});

test('proof dashboard: loads 4-tier telemetry, filters tiers, and renders boundary matrix', async ({
  page,
}) => {
  await page.goto(FeatureMap.home.route);
  await expect(page.locator(FeatureMap.home.tierCard)).toHaveCount(4);

  await page.locator(FeatureMap.home.proofsCta).click();
  await expect(page).toHaveURL(FeatureMap.proofs.route);
  await expect(page.locator(FeatureMap.proofs.heading)).toBeVisible();
  await expect(page.locator(FeatureMap.proofs.tierCard)).toHaveCount(4);
  await expect(page.locator(FeatureMap.proofs.archRows)).toHaveCount(6);
  await expect(page.locator(FeatureMap.proofs.sealBadge)).toHaveText(
    'SEAL INTACT'
  );
  await expect(page.locator(FeatureMap.proofs.sealRoot)).toHaveText(
    /^[a-f0-9]{64}$/
  );
  await expect(page.locator(FeatureMap.proofs.changelogBadge)).toContainText(
    'Chain Valid'
  );

  await page.locator(FeatureMap.proofs.tierArchitecture).click();
  await expect(page.locator(FeatureMap.proofs.tierCard)).toHaveCount(1);

  await page.locator(FeatureMap.proofs.tierAll).click();
  await expect(page.locator(FeatureMap.proofs.tierCard)).toHaveCount(4);

  await page.fill(FeatureMap.proofs.searchInput, 'Oxlint');
  await expect(page.locator(FeatureMap.proofs.tierCard)).toHaveCount(1);
});

test('links inside pages are handled by the router', async ({ page }) => {
  await page.goto(FeatureMap.userProfile.routeFor('Ada'));
  await page.evaluate(() => {
    Reflect.set(window, 'stillSamePage', true);
  });
  await page.locator(FeatureMap.userProfile.backLink).click();
  await expect(page.locator(FeatureMap.users.component)).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, 'stillSamePage'))).toBe(
    true
  );
});

test('deep links load, including nested routes with parameters', async ({
  page,
}) => {
  await page.goto(FeatureMap.todo.route);
  await expect(page.locator(FeatureMap.todo.component)).toBeVisible();

  await page.goto(FeatureMap.userProfile.routeFor('Grace Hopper'));
  await expect(page.locator(FeatureMap.userProfile.nameHeading)).toHaveText(
    'Grace Hopper'
  );
});

test('unknown routes show the not-found page', async ({ page }) => {
  await page.goto(FeatureMap.notFound.unknownRoute);
  await expect(page.locator(FeatureMap.notFound.heading)).toContainText(
    'Page Not Found'
  );
  await page.locator(FeatureMap.notFound.homeLink).click();
  await expect(page.locator(FeatureMap.home.component)).toBeVisible();
});

test('to-do list: add, complete, filter, delete and persist', async ({
  page,
}) => {
  await page.goto(FeatureMap.todo.route);
  const items = page.locator(FeatureMap.todo.item);
  await expect(items).toHaveCount(3);

  await page.fill(FeatureMap.todo.input, 'Brew tea');
  await page.keyboard.press('Enter');
  await expect(items).toHaveCount(4);
  await expect(page.locator(FeatureMap.todo.input)).toHaveValue('');

  const brewTea = items.filter({ hasText: 'Brew tea' });
  await brewTea.locator(FeatureMap.todo.itemToggle).click();
  await page.click(FeatureMap.todo.filterCompleted);
  await expect(items).toHaveCount(2);
  await page.click(FeatureMap.todo.filterActive);
  await expect(items).toHaveCount(2);
  await expect(brewTea).toHaveCount(0);

  await page.click(FeatureMap.todo.filterAll);
  await items
    .filter({ hasText: 'Discover' })
    .locator(FeatureMap.todo.itemDelete)
    .click();
  await expect(items).toHaveCount(3);

  await page.reload();
  await expect(items).toHaveCount(3);
  await expect(brewTea).toBeVisible();
});

test('users: loads from the API, validates the form, links to a profile', async ({
  page,
}) => {
  await page.goto(FeatureMap.users.route);
  const items = page.locator(FeatureMap.users.item);
  await expect(items).toHaveCount(3);

  const name = page.locator(FeatureMap.users.nameInput);
  const validationMessage = () =>
    name.evaluate((input) =>
      input instanceof HTMLInputElement ? input.validationMessage : ''
    );

  // Built-in validation: nothing is added while a required field is empty.
  await page.locator(FeatureMap.users.submitButton).click();
  await expect(items).toHaveCount(3);
  expect(await validationMessage()).not.toBe('');

  // Domain validation rule surfaced through the native validation API.
  await name.fill('ada');
  await page.locator(FeatureMap.users.roleSelect).selectOption('Designer');
  await page.locator(FeatureMap.users.submitButton).click();
  expect(await validationMessage()).toContain('already in the list');
  await expect(items).toHaveCount(3);

  await name.fill('Margaret');
  await page.locator(FeatureMap.users.submitButton).click();
  await expect(items).toHaveCount(4);
  await expect(page.locator(FeatureMap.users.status)).toHaveText(
    'Added Margaret.'
  );

  await page
    .locator(FeatureMap.users.itemLink, { hasText: 'Margaret' })
    .click();
  await expect(page).toHaveURL(FeatureMap.userProfile.routeFor('Margaret'));
  await expect(page.locator(FeatureMap.userProfile.nameHeading)).toHaveText(
    'Margaret'
  );
});

test.describe('with a failing API', () => {
  // Requests made by the service worker would bypass page.route().
  test.use({
    serviceWorkers: 'block',
    allowHttpErrorsFor: [/data\/users\.json/],
  });

  test('users: shows an error when the API fails', async ({ page }) => {
    await page.route('**/data/users.json', (route) =>
      route.fulfill({ status: 500 })
    );
    await page.goto(FeatureMap.users.route);
    await expect(page.locator(FeatureMap.users.status)).toContainText(
      'HTTP 500'
    );
  });
});

test('is installable: manifest and icons resolve', async ({
  page,
  request,
}) => {
  await page.goto(FeatureMap.home.route);
  const href = await page
    .locator('link[rel="manifest"]')
    .evaluate((el) => (el instanceof HTMLLinkElement ? el.href : ''));
  expect(href).not.toBe('');

  const response = await request.get(href);
  const manifest: unknown = await response.json();
  expect(typeof manifest === 'object' && manifest !== null).toBe(true);
  if (typeof manifest === 'object' && manifest !== null) {
    expect(Reflect.get(manifest, 'name')).toBe('Boba App');
    const icons: unknown = Reflect.get(manifest, 'icons');
    expect(Array.isArray(icons)).toBe(true);
    if (Array.isArray(icons)) {
      for (const icon of icons) {
        const src: unknown =
          typeof icon === 'object' && icon !== null
            ? Reflect.get(icon, 'src')
            : '';
        expect(typeof src).toBe('string');
        if (typeof src === 'string') {
          const iconRes = await request.get(new URL(src, href).href);
          expect(iconRes.ok()).toBe(true);
        }
      }
    }
  }
});

test.describe('offline caching', () => {
  test.use({ allowNetworkFailures: true });

  test('works offline after the first visit', async ({
    page,
    context,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'chromium',
      'the service worker is only registered in production builds'
    );
    await page.goto(FeatureMap.home.route);
    await expect(page.locator(FeatureMap.home.tierCard)).toHaveCount(4);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await (await caches.open('boba-v1')).keys()).length
        )
      )
      .toBeGreaterThan(2);

    await page.locator(FeatureMap.shell.navTodoLink).click();
    await expect(page.locator(FeatureMap.todo.component)).toBeVisible();

    await context.setOffline(true);
    await page.goto(FeatureMap.home.route);
    await expect(page.locator(FeatureMap.home.component)).toBeVisible();
    await page.goto(FeatureMap.todo.route);
    await expect(page.locator(FeatureMap.todo.component)).toBeVisible();
  });
});
