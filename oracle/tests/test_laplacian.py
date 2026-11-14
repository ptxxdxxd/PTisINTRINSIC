"""PTisINTRINSIC's cotan Laplacian, intrinsic Delaunay flips and conjugate-gradient
solves against libigl and scipy.

Measured agreement on 2026-11-12, relative to the largest Laplacian entry:
stiffness 1.2e-15, Laplacian after flipping 4e-16; Dirichlet solutions 4.9e-13
relative to the largest value (conjugate gradients stop at a relative residual
of 1e-12). The tolerances below sit a little above those.
"""

from __future__ import annotations

import igl
import numpy as np
import pytest
import scipy.sparse as sp
import scipy.sparse.linalg as spla
from numpy.typing import NDArray

from .fixtures import MeshFixture, mesh_fixtures

MESHES = mesh_fixtures()
EMBEDDED = [m for m in MESHES if m.embedded]
# Same tolerance as DELAUNAY_TOLERANCE in src/core/delaunay.ts.
DELAUNAY_TOLERANCE = 1e-12


def as_matrix(triplets: NDArray[np.float64], n: int) -> sp.csr_matrix:
    rows = triplets[:, 0].astype(np.int64)
    cols = triplets[:, 1].astype(np.int64)
    return sp.csr_matrix((triplets[:, 2], (rows, cols)), shape=(n, n))


def max_abs(m: sp.spmatrix) -> float:
    return float(abs(m).max())


def test_some_fixtures_need_flips() -> None:
    assert sum(m.delaunay_flips > 0 for m in MESHES) >= 4


@pytest.mark.parametrize("mesh", MESHES, ids=repr)
def test_stiffness_matrix_matches_libigl(mesh: MeshFixture) -> None:
    ours = as_matrix(mesh.laplacian, mesh.vertex_count)
    reference = -igl.cotmatrix_intrinsic(mesh.face_edge_lengths, mesh.faces)
    assert max_abs(ours - reference) <= 1e-14 * max_abs(reference)
    if mesh.positions is not None:
        from_positions = -igl.cotmatrix(mesh.positions, mesh.faces)
        assert max_abs(ours - from_positions) <= 1e-14 * max_abs(from_positions)


@pytest.mark.parametrize("mesh", EMBEDDED, ids=repr)
def test_laplacian_after_flipping_matches_libigl_intrinsic_delaunay(mesh: MeshFixture) -> None:
    # Bobenko and Springborn: the Laplacian depends only on the Delaunay
    # tessellation, so it must agree even if the flips happened in another order.
    reference, _, _ = igl.intrinsic_delaunay_cotmatrix(mesh.positions, mesh.faces)
    ours = as_matrix(mesh.delaunay_laplacian, mesh.vertex_count)
    assert max_abs(ours + reference) <= 1e-14 * max_abs(reference)


@pytest.mark.parametrize("mesh", MESHES, ids=repr)
def test_flipped_mesh_is_delaunay_by_libigl(mesh: MeshFixture) -> None:
    faces = mesh.delaunay_faces
    lengths = mesh.delaunay_face_edge_lengths
    flagged = ~igl.is_intrinsic_delaunay(lengths, faces).astype(bool)
    # libigl tests the exact sign. On cocircular quadrilaterals (the cone's
    # isosceles trapezoids) the weight is 0 in real arithmetic and rounding
    # decides the sign, so any edge it flags must weigh 0 within tolerance.
    weights = igl.cotmatrix_intrinsic(lengths, faces).tocsr()
    for face, corner in zip(*np.nonzero(flagged), strict=True):
        i = faces[face, (corner + 1) % 3]
        j = faces[face, (corner + 2) % 3]
        assert abs(weights[i, j]) <= DELAUNAY_TOLERANCE


@pytest.mark.parametrize("mesh", MESHES, ids=repr)
def test_flipping_keeps_the_surface(mesh: MeshFixture) -> None:
    assert mesh.delaunay_faces.shape == mesh.faces.shape
    assert set(np.unique(mesh.delaunay_faces)) == set(np.unique(mesh.faces))
    before = igl.doublearea(l=mesh.face_edge_lengths).sum()
    after = igl.doublearea(l=mesh.delaunay_face_edge_lengths).sum()
    assert after == pytest.approx(before, rel=1e-14)


@pytest.mark.parametrize("mesh", MESHES, ids=repr)
def test_dirichlet_solution_matches_a_direct_solve(mesh: MeshFixture) -> None:
    # Assemble the system from libigl's matrix, not ours, and solve it directly.
    laplacian = (-igl.cotmatrix_intrinsic(mesh.face_edge_lengths, mesh.faces)).tocsr()
    interior = np.flatnonzero(~mesh.is_boundary)
    boundary = np.flatnonzero(mesh.is_boundary)
    g = mesh.dirichlet_boundary_values
    rhs = -(laplacian[interior][:, boundary] @ g[boundary])
    direct = spla.spsolve(laplacian[interior][:, interior].tocsc(), rhs)
    ours = mesh.dirichlet_solution
    np.testing.assert_array_equal(ours[boundary], g[boundary])
    assert np.abs(ours[interior] - direct).max() <= 1e-11 * np.abs(ours).max()
