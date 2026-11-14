"""Measures how closely Intrinsic agrees with the reference libraries.

The tests in tests/ assert that each difference is below a tolerance. This
script reports the differences themselves, as JSON, for `npm run report` to
put into docs/results.md.

Usage, from this directory, after `npm run fixtures`:

    python measure_agreement.py
"""

from __future__ import annotations

import json
import platform
from importlib.metadata import version
from pathlib import Path

import igl
import numpy as np
import scipy.linalg
from mpmath import mp, mpf
from numpy.typing import NDArray

from tests.fixtures import UNIT_ROUNDOFF, mesh_fixtures, needles
from tests.test_geodesics import (
    CASES,
    EMBEDDED_CASES,
    GEOMETRY_CENTRAL_SHIFT,
    heat_distance,
    largest,
    potpourri3d_distance,
)
from tests.test_laplacian import as_matrix, max_abs
from tests.test_needles import exact_angle, exact_area
from tests.test_spectrum import pencil

OUTPUT = Path(__file__).resolve().parent / "agreement.json"


def measure_needles() -> dict[str, float]:
    mp.dps = 80
    area_error = mpf(0)
    angle_error = mpf(0)
    heron_wrong = 0
    triangles = needles()
    for needle in triangles:
        a, b, c = needle.sides
        exact = exact_area(a, b, c)
        area_error = max(area_error, abs(mpf(needle.area) - exact) / exact)
        for computed, sides in zip(needle.angles, ((a, b, c), (b, c, a), (c, a, b)), strict=True):
            angle = exact_angle(*sides)
            angle_error = max(angle_error, abs(mpf(computed) - angle) / angle)
        # The textbook formula in double precision.
        s = (a + b + c) / 2
        heron = float(np.sqrt(max(0.0, s * (s - a) * (s - b) * (s - c))))
        heron_wrong += abs(mpf(heron) - exact) / exact > mpf("1e-8")
    return {
        "triangles": len(triangles),
        "kahanAreaRoundoffs": float(area_error / UNIT_ROUNDOFF),
        "kahanAngleRoundoffs": float(angle_error / UNIT_ROUNDOFF),
        "heronWrongBeyond1e-8": heron_wrong,
    }


def measure_meshes() -> dict[str, float]:
    meshes = mesh_fixtures()
    area = stiffness = defect = flipped = spectrum = 0.0
    for mesh in meshes:
        reference_area = igl.doublearea(l=mesh.face_edge_lengths) / 2
        area = max(area, largest(mesh.face_areas - reference_area) / largest(reference_area))
        reference = -igl.cotmatrix_intrinsic(mesh.face_edge_lengths, mesh.faces)
        ours = as_matrix(mesh.laplacian, mesh.vertex_count)
        stiffness = max(stiffness, max_abs(ours - reference) / max_abs(reference))
        laplacian, mass = pencil(mesh)
        values = scipy.linalg.eigh(laplacian.toarray(), mass.toarray(), eigvals_only=True)
        spectrum = max(spectrum, largest(mesh.spectrum_values - values) / largest(values))
        if mesh.positions is None:
            continue
        curvature = np.asarray(igl.gaussian_curvature(mesh.positions, mesh.faces))
        inside = ~mesh.is_boundary
        defect = max(defect, largest((mesh.vertex_curvature - curvature)[inside]))
        delaunay, _, _ = igl.intrinsic_delaunay_cotmatrix(mesh.positions, mesh.faces)
        ours = as_matrix(mesh.delaunay_laplacian, mesh.vertex_count)
        flipped = max(flipped, max_abs(ours + delaunay) / max_abs(delaunay))
    return {
        "meshes": len(meshes),
        "faceAreaVsLibigl": area,
        "stiffnessVsLibigl": stiffness,
        "angleDefectVsLibigl": defect,
        "delaunayLaplacianVsLibigl": flipped,
        "eigenvaluesVsLapack": spectrum,
    }


def measure_geodesics() -> dict[str, float]:
    def relative(a: NDArray[np.float64], b: NDArray[np.float64]) -> float:
        return largest(a - b) / largest(b)

    direct = [relative(c.distance, heat_distance(m, c.sources, 0.0)) for m, c in CASES]
    shifted = [
        relative(
            heat_distance(m, c.sources, GEOMETRY_CENTRAL_SHIFT),
            potpourri3d_distance(m, c.sources),
        )
        for m, c in EMBEDDED_CASES
    ]
    library = [relative(c.distance, potpourri3d_distance(m, c.sources)) for m, c in EMBEDDED_CASES]
    return {
        "cases": len(CASES),
        "embeddedCases": len(EMBEDDED_CASES),
        "vsDirectReimplementation": max(direct),
        "potpourri3dVsReimplementationWithShift": max(shifted),
        "vsPotpourri3dSmallest": min(library),
        "vsPotpourri3dLargest": max(library),
    }


def main() -> None:
    result = {
        "python": platform.python_version(),
        "libraries": {
            name: version(name)
            for name in ("libigl", "potpourri3d", "numpy", "scipy", "mpmath", "meshio")
        },
        "needles": measure_needles(),
        "meshes": measure_meshes(),
        "geodesics": measure_geodesics(),
    }
    OUTPUT.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
