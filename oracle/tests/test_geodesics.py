"""Intrinsic's heat-method geodesic distance against scipy and potpourri3d.

Two references:

* A direct re-implementation here with scipy's sparse LU, from libigl's
  intrinsic cotan and mass matrices and a different formula for the gradient
  (the Dirichlet form instead of a planar layout of each face).
* potpourri3d's MeshHeatMethodDistanceSolver (geometry-central), without its
  robust Laplacian so that it runs on the same triangulation.

geometry-central solves its Poisson problem with L + 1e-6 I instead of the
singular L (heat_method_distance.cpp). That changes the distance in the fifth
digit. The re-implementation takes the shift as a parameter: with the shift it
reproduces potpourri3d, without it Intrinsic. So the difference between
Intrinsic and potpourri3d is that shift and nothing else.

Measured on 2026-11-13 over 14 cases (10 on embedded meshes), relative to the
largest distance: Intrinsic against the re-implementation 1.9e-14; potpourri3d
against the re-implementation with the shift 2.9e-15; Intrinsic against
potpourri3d between 8.4e-6 and 2.0e-5. The tolerances below sit above those.
"""

from __future__ import annotations

import igl
import numpy as np
import potpourri3d as pp3d
import pytest
import scipy.sparse as sp
import scipy.sparse.linalg as spla
from numpy.typing import NDArray

from .fixtures import GeodesicCase, MeshFixture, mesh_fixtures

MESHES = mesh_fixtures()
CASES = [(mesh, case) for mesh in MESHES for case in mesh.geodesic_cases]
EMBEDDED_CASES = [(mesh, case) for mesh, case in CASES if mesh.embedded]
# The shift geometry-central adds to the Laplacian before the Poisson solve.
GEOMETRY_CENTRAL_SHIFT = 1e-6


def case_id(value: object) -> str:
    return f"{len(value.sources)}-source" if isinstance(value, GeodesicCase) else repr(value)


def largest(values: NDArray[np.float64]) -> float:
    return float(np.max(np.abs(values)))


def mean_edge_length(mesh: MeshFixture) -> float:
    """Mean over edges (not over face sides, which would count interior edges twice)."""
    lengths: dict[tuple[int, int], float] = {}
    for face, sides in zip(mesh.faces, mesh.face_edge_lengths, strict=True):
        for corner in range(3):
            i, j = int(face[(corner + 1) % 3]), int(face[(corner + 2) % 3])
            lengths[(min(i, j), max(i, j))] = float(sides[corner])
    return sum(lengths.values()) / len(lengths)


def heat_distance(mesh: MeshFixture, sources: tuple[int, ...], shift: float) -> NDArray[np.float64]:
    """Crane, Weischedel and Wardetzky 2013, Algorithm 1, with direct solves."""
    n = mesh.vertex_count
    faces = mesh.faces
    sides = mesh.face_edge_lengths
    laplacian = (-igl.cotmatrix_intrinsic(sides, faces)).tocsc()
    mass = igl.massmatrix_intrinsic(sides, faces, igl.MASSMATRIX_TYPE_BARYCENTRIC).tocsc()
    time = mean_edge_length(mesh) ** 2

    delta = np.zeros(n)
    delta[list(sources)] = 1.0
    u = spla.spsolve(mass + time * laplacian, delta)

    a, b, c = sides.T
    s = (a + b + c) / 2
    area = np.sqrt(s * (s - a) * (s - b) * (s - c))
    cot = np.column_stack([b * b + c * c - a * a, c * c + a * a - b * b, a * a + b * b - c * c])
    cot /= (4 * area)[:, None]
    u0, u1, u2 = u[faces].T
    # |grad u|^2 from the Dirichlet energy of the face.
    norm = np.sqrt(
        (cot[:, 0] * (u1 - u2) ** 2 + cot[:, 1] * (u2 - u0) ** 2 + cot[:, 2] * (u0 - u1) ** 2)
        / (2 * area)
    )
    rhs = np.zeros(n)
    np.add.at(rhs, faces[:, 0], (cot[:, 2] * (u1 - u0) + cot[:, 1] * (u2 - u0)) / (2 * norm))
    np.add.at(rhs, faces[:, 1], (cot[:, 2] * (u0 - u1) + cot[:, 0] * (u2 - u1)) / (2 * norm))
    np.add.at(rhs, faces[:, 2], (cot[:, 1] * (u0 - u2) + cot[:, 0] * (u1 - u2)) / (2 * norm))

    phi = np.zeros(n)
    if shift == 0:
        # L is singular; fix phi at the last vertex.
        phi[:-1] = spla.spsolve(laplacian[:-1, :-1], rhs[:-1])
    else:
        phi = spla.spsolve(laplacian + shift * sp.identity(n, format="csc"), rhs)
    return np.asarray(phi - phi[list(sources)].mean(), dtype=np.float64)


def potpourri3d_distance(mesh: MeshFixture, sources: tuple[int, ...]) -> NDArray[np.float64]:
    solver = pp3d.MeshHeatMethodDistanceSolver(mesh.positions, mesh.faces, use_robust=False)
    if len(sources) == 1:
        return np.asarray(solver.compute_distance(sources[0]), dtype=np.float64)
    return np.asarray(solver.compute_distance_multisource(list(sources)), dtype=np.float64)


def test_fixtures_cover_single_and_multiple_sources() -> None:
    assert {len(case.sources) for _, case in CASES} == {1, 3}
    assert len(EMBEDDED_CASES) >= 8


@pytest.mark.parametrize("mesh", MESHES, ids=repr)
def test_time_step_is_the_squared_mean_edge_length(mesh: MeshFixture) -> None:
    assert mesh.geodesic_time == pytest.approx(mean_edge_length(mesh) ** 2, rel=1e-13)


@pytest.mark.parametrize(("mesh", "case"), CASES, ids=case_id)
def test_distance_matches_a_direct_reimplementation(mesh: MeshFixture, case: GeodesicCase) -> None:
    reference = heat_distance(mesh, case.sources, shift=0.0)
    assert largest(case.distance - reference) <= 1e-12 * largest(reference)


@pytest.mark.parametrize(("mesh", "case"), EMBEDDED_CASES, ids=case_id)
def test_distance_matches_potpourri3d(mesh: MeshFixture, case: GeodesicCase) -> None:
    reference = potpourri3d_distance(mesh, case.sources)
    assert largest(case.distance - reference) <= 1e-4 * largest(reference)


@pytest.mark.parametrize(("mesh", "case"), EMBEDDED_CASES, ids=case_id)
def test_the_gap_to_potpourri3d_is_its_laplacian_shift(
    mesh: MeshFixture, case: GeodesicCase
) -> None:
    reference = potpourri3d_distance(mesh, case.sources)
    shifted = heat_distance(mesh, case.sources, shift=GEOMETRY_CENTRAL_SHIFT)
    assert largest(shifted - reference) <= 1e-12 * largest(reference)
    # Without the shift the re-implementation is measurably further away.
    unshifted = heat_distance(mesh, case.sources, shift=0.0)
    assert largest(unshifted - reference) >= 1e-6 * largest(reference)
