# Intrinsic

Discrete curvature, Laplacians, spectra and geodesic distance on triangle meshes, computed from
edge lengths alone and checked against analytic answers and established reference libraries.

**Status:** under construction. This README will describe the methods and report measured
results once they exist; it will not report numbers that no script produced.

## Development

Node 22.18 or newer.

```sh
npm ci
npm run check       # ESLint, Prettier, tsc, Vitest with coverage, production build
npx playwright install chromium
npm run test:e2e    # Playwright against the production build, desktop and phone viewports
```

The differential tests recompute the same quantities with libigl, potpourri3d, scipy and
mpmath. Python 3.11 to 3.13:

```sh
npm run fixtures    # writes oracle/fixtures/*.json from the TypeScript core
python -m venv .venv && . .venv/bin/activate
pip install -r oracle/requirements.txt
cd oracle && ruff check . && ruff format --check . && mypy && pytest
```

## Licence

Apache-2.0. Copyright 2026 PTisDEV.
