"""PTisINTRINSIC's dense symmetric eigensolver and mesh spectra against LAPACK
(numpy.linalg.eigh, scipy.linalg.eigh) and ARPACK (scipy.sparse.linalg.eigsh).

Measured on 2026-11-12: random symmetric matrices up to n = 150, eigenvalues
within 1.6e-13 · max|A|, residuals 3.4e-14 · max|A|, orthonormality 1.2e-14;
mesh pencils, all eigenvalues within 1.8e-14 · λmax of scipy's generalized
dense solver and the lowest ten within 1.2e-14 · λmax of eigsh, residuals
against libigl's matrices 1.4e-16 · λmax, M-orthonormality 3.3e-14.
"""

from __future__ import annotations

import igl
import numpy as np
import pytest
import scipy.linalg as sla
import scipy.sparse as sp
import scipy.sparse.linalg as spla

from .fixtures import MeshFixture, SymmetricCase, mesh_fixtures, symmetric_cases

CASES = symmetric_cases()
MESHES = mesh_fixtures()


def test_cases_cover_a_range_of_sizes() -> None:
    sizes = [case.values.size for case in CASES]
    assert min(sizes) == 1
    assert max(sizes) >= 100


@pytest.mark.parametrize("case", CASES, ids=repr)
def test_eigenvalues_match_lapack(case: SymmetricCase) -> None:
    scale = max(np.abs(case.matrix).max(), 1.0)
    reference = np.linalg.eigh(case.matrix).eigenvalues
    assert np.abs(case.values - reference).max() <= 1e-12 * scale


@pytest.mark.parametrize("case", CASES, ids=repr)
def test_eigenvectors_are_orthonormal_and_satisfy_the_equation(case: SymmetricCase) -> None:
    scale = max(np.abs(case.matrix).max(), 1.0)
    v = case.vectors
    residual = case.matrix @ v.T - v.T * case.values
    assert np.abs(residual).max() <= 1e-13 * scale
    assert np.abs(v @ v.T - np.eye(case.values.size)).max() <= 1e-13


def pencil(mesh: MeshFixture) -> tuple[sp.csc_matrix, sp.csc_matrix]:
    """Stiffness and barycentric mass from libigl, assembled independently of PTisINTRINSIC."""
    stiffness = -igl.cotmatrix_intrinsic(mesh.face_edge_lengths, mesh.faces)
    mass = igl.massmatrix_intrinsic(
        mesh.face_edge_lengths, mesh.faces, igl.MASSMATRIX_TYPE_BARYCENTRIC
    )
    return stiffness, mass


@pytest.mark.parametrize("mesh", MESHES, ids=repr)
def test_full_mesh_spectrum_matches_scipy(mesh: MeshFixture) -> None:
    stiffness, mass = pencil(mesh)
    reference = sla.eigh(stiffness.toarray(), mass.toarray(), eigvals_only=True)
    assert mesh.spectrum_values.size == reference.size
    assert np.abs(mesh.spectrum_values - reference).max() <= 1e-13 * reference.max()


@pytest.mark.parametrize("mesh", MESHES, ids=repr)
def test_lowest_eigenvalues_match_arpack(mesh: MeshFixture) -> None:
    stiffness, mass = pencil(mesh)
    lowest = spla.eigsh(
        stiffness.tocsc(), k=10, M=mass.tocsc(), sigma=-1e-3, which="LM", return_eigenvectors=False
    )
    lowest.sort()
    largest = float(np.max(mesh.spectrum_values))
    assert np.abs(mesh.spectrum_values[:10] - lowest).max() <= 1e-13 * largest


@pytest.mark.parametrize("mesh", MESHES, ids=repr)
def test_eigenfunctions_solve_the_pencil_and_are_mass_orthonormal(mesh: MeshFixture) -> None:
    stiffness, mass = pencil(mesh)
    vectors = mesh.spectrum_vectors
    values = mesh.spectrum_values[: vectors.shape[0]]
    largest = float(np.max(mesh.spectrum_values))
    residual = stiffness @ vectors.T - (mass @ vectors.T) * values
    assert np.abs(residual).max() <= 1e-14 * largest
    gram = vectors @ (mass @ vectors.T)
    assert np.abs(gram - np.eye(vectors.shape[0])).max() <= 1e-12
