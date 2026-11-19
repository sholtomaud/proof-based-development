import { test as base, expect } from '@playwright/test';

export interface ProofOptions {
  /** URL patterns expected to return HTTP >= 400 (only for negative-path tests). */
  allowHttpErrorsFor: readonly RegExp[];
  /** Allows browser network failures (only for explicit offline-mode tests). */
  allowNetworkFailures: boolean;
}

/**
 * Shared Playwright proof fixture.
 * Automatically fails any E2E test that triggers an uncaught exception,
 * console error, failed network request, or unexpected HTTP >= 400 response.
 */
export const test = base.extend<ProofOptions>({
  allowHttpErrorsFor: [[], { option: true }],
  allowNetworkFailures: [false, { option: true }],
  page: async ({ page, allowHttpErrorsFor, allowNetworkFailures }, use) => {
    const failures: string[] = [];

    page.on('pageerror', (error) => {
      failures.push(`Uncaught pageerror: ${error.message}`);
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const isExpectedHttpError =
          allowHttpErrorsFor.length > 0 &&
          text.includes('Failed to load resource');
        if (!isExpectedHttpError) {
          failures.push(`console.error: ${text}`);
        }
      }
    });

    page.on('requestfailed', (request) => {
      if (allowNetworkFailures) return;
      const url = request.url();
      const allowed = allowHttpErrorsFor.some((pattern) => pattern.test(url));
      if (!allowed) {
        const reason = request.failure()?.errorText ?? 'unknown error';
        failures.push(`Request failed (${reason}): ${url}`);
      }
    });

    page.on('response', (response) => {
      if (response.status() < 400) return;
      const url = response.url();
      const allowed = allowHttpErrorsFor.some((pattern) => pattern.test(url));
      if (!allowed) {
        failures.push(`HTTP ${response.status()} response: ${url}`);
      }
    });

    await use(page);
    expect(failures, 'Zero runtime/console/network errors invariant').toEqual(
      []
    );
  },
});

export { expect };
