import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTHOR, STAMP } from '../../src/app/signature.ts';
import { toCsv, toObj, toVtk } from '../../src/core/index.ts';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

describe('signature', () => {
  it('ends the README with the same stamp the page shows', () => {
    expect(STAMP).toContain(AUTHOR);
    expect(read('README.md').endsWith(`\n\`\`\`text\n${STAMP}\n\`\`\`\n`)).toBe(true);
  });

  it('names the same author in the package and the NOTICE', () => {
    const pkg = JSON.parse(read('package.json')) as { author: string; name: string };
    expect(pkg.author).toBe(AUTHOR);
    expect(read('NOTICE')).toContain(`Copyright 2026 ${AUTHOR}`);
  });

  it('stays out of exported files, which are data', () => {
    const mesh = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], faces: [0, 1, 2] };
    const fields = [{ name: 'f', values: [1, 2, 3] }];
    for (const text of [toVtk(mesh, fields, 'title'), toObj(mesh, 'title'), toCsv(mesh, fields)]) {
      expect(text).not.toContain(AUTHOR);
      expect(text).not.toContain('(o o)');
    }
  });
});
