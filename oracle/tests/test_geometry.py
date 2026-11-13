"""Intrinsic's areas, angles and curvature against libigl and mpmath.

Tolerances are a little above the agreement measured on 2026-11-12 and recorded
in the plan's findings: edge lengths 5.6e-17, face areas 7e-18, corner angles
6.7e-16, interior angle defects 2.1e-15, vertex areas 4.6e-16 relative.
"""

from __future__ import annotations

import math

import igl
import numpy as np
import pytest
from mpmath import mp, mpf

from .fixtures import MeshFixture, mesh_fixtures

MESHES = mesh_fixtures()
EMBEDDED = [m for m in MESHES if m.embedded]
INTRINSIC = [m for m in MESHES if not m.embedded]


def test_fixture_set_covers_both_kinds() -> None:
    assert len(EMBEDDED) >= 4
    assert len(INTRINSIC) >= 2


@pytest.mark.parametrize("mesh", EMBEDDED, ids=repr)
def test_edge_lengths_are_the_chord_lengths(mesh: MeshFixture) -> None:
    assert mesh.positions is not None
    np.testing.assert_allclose(
        mesh.face_edge_lengths, igl.edge_lengths(mesh.positions, mesh.faces), rtol=1e-15, atol=0
    )


@pytest.mark.parametrize("mesh", MESHES, ids=repr)
def test_face_areas_match_libigl(mesh: MeshFixture) -> None:
    expected = igl.doublearea(l=mesh.face_edge_lengths) / 2
    np.testing.assert_allclose(mesh.face_areas, expected, rtol=1e-14, atol=0)


@pytest.mark.parametrize("mesh", EMBEDDED, ids=repr)
def test_corner_angles_match_libigl(mesh: MeshFixture) -> None:
    expected = igl.internal_angles(mesh.positions, mesh.faces)
    np.testing.assert_allclose(mesh.corner_angles, expected, rtol=0, atol=1e-14)


@pytest.mark.parametrize("mesh", INTRINSIC, ids=repr)
def test_corner_angles_match_mpmath(mesh: MeshFixture) -> None:
    # libigl has no intrinsic angle function in Python, so compute each angle to
    # 40 digits from the law of cosines and round once.
    mp.dps = 40
    for lengths, angles in zip(mesh.face_edge_lengths, mesh.corner_angles, strict=True):
        for corner in range(3):
            opposite = mpf(lengths[corner])
            a = mpf(lengths[(corner + 1) % 3])
            b = mpf(lengths[(corner + 2) % 3])
            exact = float(mp.acos((a * a + b * b - opposite * opposite) / (2 * a * b)))
            assert math.isclose(angles[corner], exact, rel_tol=1e-14, abs_tol=0)


@pytest.mark.parametrize("mesh", EMBEDDED, ids=repr)
def test_interior_angle_defects_match_libigl(mesh: MeshFixture) -> None:
    expected = np.asarray(igl.gaussian_curvature(mesh.positions, mesh.faces), dtype=np.float64)
    interior = ~mesh.is_boundary
    np.testing.assert_allclose(
        mesh.vertex_curvature[interior], expected[interior], rtol=0, atol=1e-13
    )


@pytest.mark.parametrize("mesh", MESHES, ids=repr)
def test_curvature_is_the_angle_defect_of_the_reported_angles(mesh: MeshFixture) -> None:
    # Independent of libigl: rebuild every vertex's curvature from the angles.
    sums = np.zeros(mesh.vertex_curvature.shape)
    np.add.at(sums, mesh.faces.ravel(), mesh.corner_angles.ravel())
    expected = np.where(mesh.is_boundary, math.pi, 2 * math.pi) - sums
    np.testing.assert_allclose(mesh.vertex_curvature, expected, rtol=0, atol=1e-13)


@pytest.mark.parametrize("mesh", MESHES, ids=repr)
def test_vertex_areas_match_libigl_mass_matrices(mesh: MeshFixture) -> None:
    lengths = mesh.face_edge_lengths
    barycentric = igl.massmatrix_intrinsic(lengths, mesh.faces, igl.MASSMATRIX_TYPE_BARYCENTRIC)
    voronoi = igl.massmatrix_intrinsic(lengths, mesh.faces, igl.MASSMATRIX_TYPE_VORONOI)
    np.testing.assert_allclose(mesh.barycentric_areas, barycentric.diagonal(), rtol=1e-14, atol=0)
    np.testing.assert_allclose(mesh.mixed_areas, voronoi.diagonal(), rtol=1e-14, atol=0)
