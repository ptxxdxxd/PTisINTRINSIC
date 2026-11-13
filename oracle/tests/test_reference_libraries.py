"""Pin down the conventions of the reference libraries.

The differential tests compare Intrinsic against libigl and potpourri3d. These
tests record the sign and boundary conventions those comparisons rely on, so a
change in a library shows up here rather than as a confusing mismatch later.
"""

from __future__ import annotations

import math

import igl
import numpy as np
import potpourri3d as pp3d
import pytest

from .meshes import unit_square_grid


def test_cotmatrix_is_negative_semidefinite_with_zero_row_sums() -> None:
    vertices, faces = unit_square_grid(6)
    laplacian = igl.cotmatrix(vertices, faces).toarray()
    np.testing.assert_allclose(laplacian, laplacian.T, atol=0)
    np.testing.assert_allclose(laplacian.sum(axis=1), 0.0, atol=1e-12)
    assert np.all(np.diag(laplacian) < 0)
    assert np.linalg.eigvalsh(laplacian).max() < 1e-12


def test_barycentric_mass_sums_to_total_area() -> None:
    vertices, faces = unit_square_grid(6)
    mass = igl.massmatrix(vertices, faces, igl.MASSMATRIX_TYPE_BARYCENTRIC).toarray()
    np.testing.assert_allclose(mass, np.diag(np.diag(mass)), atol=0)
    assert float(mass.sum()) == pytest.approx(1.0, rel=1e-14)


def test_gaussian_curvature_is_two_pi_minus_angle_sum_including_boundary() -> None:
    n = 6
    vertices, faces = unit_square_grid(n)
    curvature = np.asarray(igl.gaussian_curvature(vertices, faces), dtype=np.float64)
    grid = curvature.reshape(n + 1, n + 1)
    np.testing.assert_allclose(grid[1:-1, 1:-1], 0.0, atol=1e-12)
    np.testing.assert_allclose(grid[0, 1:-1], math.pi, atol=1e-12)
    corners = np.array([grid[0, 0], grid[0, -1], grid[-1, 0], grid[-1, -1]])
    np.testing.assert_allclose(corners, 1.5 * math.pi, atol=1e-12)


def test_heat_method_distance_improves_under_refinement() -> None:
    errors = []
    for n in (4, 8, 16, 32):
        vertices, faces = unit_square_grid(n)
        center = (n // 2) * (n + 1) + n // 2
        solver = pp3d.MeshHeatMethodDistanceSolver(vertices, faces, t_coef=1.0, use_robust=False)
        distance = np.asarray(solver.compute_distance(center), dtype=np.float64)
        exact = np.hypot(vertices[:, 0] - 0.5, vertices[:, 1] - 0.5)
        errors.append(float(np.abs(distance - exact).max()))
    assert errors == sorted(errors, reverse=True), errors
