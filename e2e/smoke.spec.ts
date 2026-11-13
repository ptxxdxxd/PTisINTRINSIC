import { expect, test } from '@playwright/test';

test('the app loads with no console errors or warnings', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => problems.push(`requestfailed: ${request.url()}`));
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`);
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Intrinsic' })).toBeVisible();
  expect(problems).toEqual([]);
});
