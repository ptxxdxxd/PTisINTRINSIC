import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fieldSelect, open, status } from './support/page.ts';

/** Violations of WCAG 2.1 levels A and AA, one line each with the elements involved. */
async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(' ')).join(', ')})`,
  );
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`meets WCAG 2.1 AA in each view, ${colorScheme} scheme`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme });
    const problems = await open(page);
    expect(await violations(page), 'curvature view').toEqual([]);

    await fieldSelect(page).selectOption('distance');
    await expect(status(page)).toHaveText('Ready');
    expect(await violations(page), 'distance view').toEqual([]);

    await fieldSelect(page).selectOption('eigen');
    await expect(status(page)).toHaveText('Ready', { timeout: 60_000 });
    await expect(page.getByTestId('spectrum-summary')).toContainText('eigenvalues in');
    expect(await violations(page), 'eigenfunction view with the spectrum charts').toEqual([]);

    await page.getByLabel('Compute on the intrinsic Delaunay triangulation').check();
    await expect(status(page)).toHaveText('Ready', { timeout: 60_000 });
    expect(await violations(page), 'Delaunay note shown').toEqual([]);
    expect(problems).toEqual([]);
  });
}

test('the distance source can be set from the keyboard', async ({ page }) => {
  const problems = await open(page);
  await fieldSelect(page).selectOption('distance');
  await expect(status(page)).toHaveText('Ready');

  await fieldSelect(page).focus();
  await page.keyboard.press('Tab');
  const source = page.getByRole('spinbutton', { name: 'Source vertex' });
  await expect(source).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('100');
  await expect(page.getByTestId('sources')).toContainText('From vertex 100.');
  await expect(status(page)).toHaveText('Ready');
  expect(problems).toEqual([]);
});
