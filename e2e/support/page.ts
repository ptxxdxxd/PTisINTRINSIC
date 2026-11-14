import { expect, type Page } from '@playwright/test';

/** Collects everything that should never happen while the app runs. */
export function watch(page: Page): string[] {
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
  return problems;
}

export const status = (page: Page) => page.getByTestId('status');
export const canvas = (page: Page) => page.locator('canvas');
export const surfaceSelect = (page: Page) => page.getByRole('combobox', { name: 'Surface' });
export const fieldSelect = (page: Page) => page.getByRole('combobox', { name: 'Field' });
export const value = async (page: Page, id: string) =>
  Number(await page.getByTestId(id).getAttribute('data-value'));

export async function open(page: Page): Promise<string[]> {
  const problems = watch(page);
  await page.goto('/');
  await expect(status(page)).toHaveText('Ready');
  await expect(canvas(page)).toHaveAttribute('data-frames', /^[1-9]/);
  return problems;
}
