import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { canvas, fieldSelect, open, status, surfaceSelect, value } from './support/page.ts';

const SURFACES = ['bump', 'saddle', 'cap', 'cone', 'plane'] as const;
const FIELDS = ['gaussian', 'exact', 'error', 'angleDefect', 'area', 'distance', 'eigen'] as const;

test('every surface renders every field with no errors', async ({ page }) => {
  test.setTimeout(240_000);
  const problems = await open(page);
  for (const surface of SURFACES) {
    await surfaceSelect(page).selectOption(surface);
    await expect(status(page)).toHaveText('Ready');
    const vertices = await value(page, 'counts');
    expect(vertices).toBeGreaterThan(100);
    // Gauss–Bonnet holds to rounding on every surface.
    expect(Math.abs(await value(page, 'gauss-bonnet-residual'))).toBeLessThan(1e-9);

    for (const field of FIELDS) {
      await fieldSelect(page).selectOption(field);
      await expect(status(page)).toHaveText('Ready', { timeout: 60_000 });
      // Distance and eigenfunctions are defined at every vertex; curvature not on the boundary.
      const defined = Number(await canvas(page).getAttribute('data-defined'));
      if (
        field === 'distance' ||
        field === 'eigen' ||
        field === 'area' ||
        field === 'angleDefect'
      ) {
        expect(defined, `${surface} ${field}`).toBe(vertices);
      } else {
        expect(defined, `${surface} ${field}`).toBeGreaterThan(vertices / 2);
        expect(defined, `${surface} ${field}`).toBeLessThan(vertices);
      }
    }
    await expect(page.getByTestId('spectrum-summary')).toContainText('eigenvalues in');
    await fieldSelect(page).selectOption('gaussian');
  }
  expect(problems).toEqual([]);
});

test('flipping to intrinsic Delaunay removes every non-Delaunay edge', async ({ page }) => {
  const problems = await open(page);
  await surfaceSelect(page).selectOption('cap');
  await expect(status(page)).toHaveText('Ready');
  expect(await value(page, 'flips')).toBe(0);
  expect(Number(await page.getByTestId('non-delaunay-input').textContent())).toBeGreaterThan(0);
  expect(await value(page, 'smallest-weight')).toBeLessThan(0);
  const before = await value(page, 'gauss-bonnet-residual');

  await page.getByLabel('Compute on the intrinsic Delaunay triangulation').check();
  await expect(status(page)).toHaveText('Ready');
  expect(await value(page, 'flips')).toBeGreaterThan(0);
  await expect(page.getByTestId('flips')).toHaveText(/ \/ 0$/);
  expect(await value(page, 'smallest-weight')).toBeGreaterThanOrEqual(-1e-12);
  // The surface is the same, so its total curvature is too.
  expect(Math.abs((await value(page, 'gauss-bonnet-residual')) - before)).toBeLessThan(1e-9);
  expect(problems).toEqual([]);
});

test('a distance or eigenfunction view recomputes for a new surface', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = await open(page);
  const vertices = String(await value(page, 'counts'));
  await fieldSelect(page).selectOption('eigen');
  await expect(status(page)).toHaveText('Ready', { timeout: 60_000 });
  await expect(canvas(page)).toHaveAttribute('data-defined', vertices);

  // Same vertices, new triangulation: the old eigenfunctions no longer apply.
  await page.getByLabel('Compute on the intrinsic Delaunay triangulation').check();
  await expect(status(page)).toHaveText('Ready', { timeout: 60_000 });
  await expect(page.getByTestId('spectrum-summary')).toContainText('eigenvalues in');
  await expect(canvas(page)).toHaveAttribute('data-defined', vertices);

  await fieldSelect(page).selectOption('distance');
  await expect(status(page)).toHaveText('Ready');
  await surfaceSelect(page).selectOption('saddle');
  await expect(status(page)).toHaveText('Ready');
  await expect(page.getByTestId('sources')).toContainText(/From vertex \d+\./);
  const saddle = String(await value(page, 'counts'));
  await expect(canvas(page)).toHaveAttribute('data-defined', saddle);
  expect(problems).toEqual([]);
});

test('clicking the surface inspects a vertex and moves the distance source', async ({ page }) => {
  const problems = await open(page);
  await fieldSelect(page).selectOption('distance');
  await expect(status(page)).toHaveText('Ready');
  const sources = page.getByTestId('sources');
  await expect(sources).toContainText('From vertex 312.');
  expect(await page.getByTestId('legend-low').textContent()).toBe('0');

  const box = await canvas(page).boundingBox();
  if (box === null) throw new Error('canvas has no box');
  // Both points are near the middle of the canvas, on the surface.
  await page.mouse.click(box.x + box.width * 0.44, box.y + box.height * 0.55);
  await expect(page.getByTestId('inspector')).toBeVisible();
  await expect(sources).not.toContainText('From vertex 312.');
  await expect(sources).toContainText(/From vertex \d+\./);
  await expect(status(page)).toHaveText('Ready');

  // The same from the keyboard: type a vertex number.
  await page.getByLabel('Source vertex').fill('7');
  await expect(sources).toContainText('From vertex 7.');
  await expect(status(page)).toHaveText('Ready');

  // Shift-click adds a second source.
  // Typing scrolled the page on a phone; find the canvas again.
  await canvas(page).scrollIntoViewIfNeeded();
  const moved = await canvas(page).boundingBox();
  if (moved === null) throw new Error('canvas has no box');
  await page.keyboard.down('Shift');
  await page.mouse.click(moved.x + moved.width * 0.56, moved.y + moved.height * 0.6);
  await page.keyboard.up('Shift');
  await expect(sources).toContainText(/From vertex \d+, \d+\./);
  await expect(status(page)).toHaveText('Ready');
  expect(problems).toEqual([]);
});

test('exports download files with the mesh on screen', async ({ page }) => {
  const problems = await open(page);
  const vertices = await value(page, 'counts');
  const save = async (name: string) => {
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name, exact: true }).click(),
    ]);
    return readFile(await file.path(), 'utf8');
  };
  const vtk = await save('VTK');
  expect(
    vtk.startsWith('# vtk DataFile Version 3.0\nPTisINTRINSIC: Gaussian bump, 625 vertices\n'),
  ).toBe(true);
  expect(vtk).toContain(`POINTS ${vertices} double`);
  expect(vtk).toContain('SCALARS gaussian_curvature double 1');
  const obj = await save('OBJ');
  expect(obj.split('\n').filter((line) => line.startsWith('v '))).toHaveLength(vertices);
  const csv = await save('CSV');
  expect(csv.split('\n')[0]).toBe(
    'vertex,x,y,z,gaussian_curvature,exact_curvature,angle_defect,vertex_area',
  );
  expect(csv.trimEnd().split('\n')).toHaveLength(vertices + 1);
  expect(problems).toEqual([]);
});

test('the page fits its window', async ({ page }) => {
  const problems = await open(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // The surface is on screen without scrolling, and big enough to use.
  const box = await canvas(page).boundingBox();
  const window = page.viewportSize();
  if (box === null || window === null) throw new Error('no layout');
  expect(box.y + box.height).toBeLessThanOrEqual(window.height);
  expect(box.width).toBeGreaterThan(0.6 * window.width - 400);
  expect(box.height).toBeGreaterThan(300);
  // The author's stamp sits at the end of the panel.
  await expect(page.locator('footer.signature pre')).toHaveText(/PTisDEV/);
  expect(problems).toEqual([]);
});
