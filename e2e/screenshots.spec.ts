/**
 * Captures the pictures used in the README and for visual review. Kept apart
 * from app.spec.ts because capturing a WebGL canvas makes the software
 * renderer log a "GPU stall due to ReadPixels" performance warning, which is
 * about the capture and not the app; app.spec.ts takes no screenshots and
 * allows no warnings at all.
 */
import { expect, test } from '@playwright/test';
import { fieldSelect, open, status, surfaceSelect } from './support/page.ts';

const SHOTS = [
  { name: 'bump-curvature', surface: 'bump', field: 'gaussian', delaunay: false },
  { name: 'saddle-distance', surface: 'saddle', field: 'distance', delaunay: false },
  { name: 'cap-distance-delaunay', surface: 'cap', field: 'distance', delaunay: true },
  { name: 'cone-eigenfunction', surface: 'cone', field: 'eigen', delaunay: false },
  { name: 'plane-error', surface: 'plane', field: 'error', delaunay: false },
] as const;

test('screenshots', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const problems = await open(page);
  for (const shot of SHOTS) {
    await surfaceSelect(page).selectOption(shot.surface);
    await page
      .getByLabel('Compute on the intrinsic Delaunay triangulation')
      .setChecked(shot.delaunay);
    await expect(status(page)).toHaveText('Ready');
    await fieldSelect(page).selectOption(shot.field);
    await expect(status(page)).toHaveText('Ready', { timeout: 60_000 });
    await page.screenshot({ path: `screenshots/${testInfo.project.name}/${shot.name}.png` });
  }
  // The spectrum charts, for the flat square (the last surface above), where
  // the continuum curve is known.
  await fieldSelect(page).selectOption('eigen');
  await expect(status(page)).toHaveText('Ready', { timeout: 60_000 });
  await page
    .locator('section[aria-labelledby="spectrum"]')
    .screenshot({ path: `screenshots/${testInfo.project.name}/spectrum.png` });
  await page.screenshot({
    path: `screenshots/${testInfo.project.name}/full-page.png`,
    fullPage: true,
  });
  expect(problems.filter((p) => !p.includes('GPU stall due to ReadPixels'))).toEqual([]);
});
