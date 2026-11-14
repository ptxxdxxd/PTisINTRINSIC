# Methods

What each part of `src/core` computes, the formula it uses, why that formula, and how it is
tested. Measured accuracy is in [results.md](results.md).

## The mesh

`mesh.ts`. A halfedge mesh stored in flat typed arrays. Face `f` owns halfedges `3f`, `3f + 1` and
`3f + 2`, so "next", "previous" and "face of" are arithmetic and only the twin of each halfedge is
stored. `fromFaces` accepts an oriented manifold triangle list and rejects everything else, with
a message naming the first problem.

`flipEdge` replaces the diagonal of the quadrilateral formed by an edge's two faces. The result
need not be a simplicial complex: a flip may put a second edge between two vertices, or make an
edge that starts and ends at the same vertex. Such a triangulation (a Δ-complex) is perfectly
good intrinsically, and some surfaces have no Delaunay triangulation without one.
`validateConnectivity` checks the halfedge invariants directly for these meshes.

## Triangles

`triangle.ts`. Area and angles of a triangle from its three side lengths. Heron's formula and the
law of cosines lose all accuracy on thin triangles, where two sides nearly add up to the third.
Kahan's rearrangements [1] keep a relative error of a few units of roundoff for every triangle.
They are tested against 80-digit arithmetic on thin triangles built for the purpose.

## Curvature

`geometry.ts`, `curvature.ts`. The angle defect of an interior vertex is 2π minus the sum of the
angles around it; on the boundary, π minus that sum. It is the Gaussian curvature integrated over
the vertex's neighbourhood. Summed over the mesh it equals 2π times the Euler characteristic
exactly (the discrete Gauss–Bonnet theorem), which the tests and the app both check. As a check
it is weaker than it looks: it holds whenever each triangle's angles sum to π and the
connectivity is right, whatever the individual angles are. Those are tested against libigl and
against 80-digit arithmetic.

Dividing the defect by a vertex area gives a pointwise estimate. The area used is the mixed
Voronoi area of Meyer et al. [2]. The estimate converges to the curvature of a smooth surface
only on meshes with special regularity [3]; the test suite measures second-order convergence on
regular grids and its failure on jittered ones, and the app says so next to the number.

## Laplacian

`laplacian.ts`. The cotan stiffness matrix [4]: edge `ij` has weight (cot α + cot β) / 2 for the
two angles opposite it. It is the exact matrix of the Dirichlet energy of piecewise-linear
functions, so it is symmetric and positive semidefinite, and it reproduces linear functions on
flat meshes; all three are tested. The mass matrix is diagonal (barycentric vertex areas).

## Intrinsic Delaunay triangulation

`delaunay.ts`. An edge is Delaunay when the two angles opposite it sum to at most π, which is
when its cotan weight is non-negative. Flipping every edge that is not Delaunay ends with the
intrinsic Delaunay triangulation [5, 6]. The new edge's length comes from unfolding its two
faces into the plane. Every interior edge of the result has a non-negative weight, and the
Laplacian does not depend on the order of the flips [5], which is how it is compared with
libigl's. A boundary edge cannot be flipped and keeps a negative weight if the angle facing it
is obtuse.

The flips change which triangles cover the surface, never the surface. The tests check that
every vertex keeps its angle defect and the total area is unchanged.

## Linear solvers

`sparse.ts`, `solvers.ts`, `cholesky.ts`. Compressed sparse row storage; conjugate gradients with
Jacobi preconditioning [7]; and a sparse Cholesky factorization. The factorization reorders the
matrix by reverse Cuthill–McKee, starting from a pseudo-peripheral vertex, and stores the factor
by envelope [8]. That is simple and has no symbolic phase. Its cost grows faster than a
nested-dissection solver's, which is the right trade for meshes of the size a browser draws.

Conjugate gradients are not used for the heat method, for a measured reason: see
[results.md](results.md#why-a-direct-solver).

## Spectrum

`eigen.ts`, `spectrum.ts`. The generalized problem L φ = λ M φ is reduced to an ordinary symmetric
one with M^(−1/2), then solved by Householder tridiagonalization and implicit QL iteration, the
EISPACK routines `tred2` and `tql2` as ported in JAMA. Two changes were forced by random testing.
The matrix is first scaled by a power of two, which is exact. And a subdiagonal entry is treated
as zero when it is below roundoff times the norm of the whole matrix, not of the rows processed
so far: with the original rule, a matrix with tiny leading rows produced NaN.

The heat trace Z(t) = Σ exp(−λt) and its logarithmic slope (the spectral dimension) are computed
from the eigenvalues and nothing else. For the unit square the exact Neumann heat trace is known
as a product of theta functions; the tests compare the mesh against it and check the small-time
expansion A/(4πt) + P/(8√(πt)) + 1/4. The app plots the eigenvalue counting function against
Weyl's law with its boundary term, (Aλ + P√λ)/4π; a unit test checks that law against an exact
count of the square's eigenvalues.

## Geodesic distance

`geodesics.ts`. The heat method [9]: take one implicit heat step from the source, normalize the
gradient in every face, and solve a Poisson problem for the function with that gradient. All
three steps need only edge lengths. Both matrices are factored once.

The result is the distance smoothed over about one edge length. Measured against exact
distances, the error falls at second order only when the source sits on an axis of symmetry
(a cone's apex, a sphere's pole); from a general vertex it falls at first order or slower.

Departures from the plain algorithm, each with a test:

- If the heat falls below the smallest normal double anywhere, the call fails and says to use a
  longer time step. The alternative is a distance that silently stops growing. If the step is
  so long that the heat is constant to rounding over most of the mesh, the call fails too.
- A face in which the heat is constant to rounding error is skipped. Normalizing its gradient
  would turn rounding noise into a unit vector. This happens whenever symmetry makes all three
  corners of a face equally far from the source.
- The Poisson system is solved exactly, by fixing one vertex, not by adding a small multiple of
  the identity as geometry-central does. The differential tests reproduce geometry-central's
  result by adding the same shift, which shows the two implementations agree in everything else.

## Supporting pieces

`summation.ts`: Neumaier's compensated summation [10], used wherever many numbers of mixed sign
are added. `random.ts`: Mulberry32, a small seedable generator, so every generated mesh is
reproducible. `exporters.ts`: VTK, OBJ and CSV, written with the shortest decimals that read back
as the same doubles; the differential tests read them back with meshio.

The app's sequential colour map is cubehelix [11], designed to rise steadily in perceived
brightness, so it still reads when printed in greyscale.

## References

1. W. Kahan, "Miscalculating Area and Angles of a Needle-like Triangle", lecture notes, 1999.
2. M. Meyer, M. Desbrun, P. Schröder and A. H. Barr, "Discrete Differential-Geometry Operators for
   Triangulated 2-Manifolds", in Visualization and Mathematics III, Springer, 2003.
3. V. Borrelli, F. Cazals and J.-M. Morvan, "On the angular defect of triangulations and the
   pointwise approximation of curvatures", Computer Aided Geometric Design 20(6), 2003.
4. U. Pinkall and K. Polthier, "Computing Discrete Minimal Surfaces and Their Conjugates",
   Experimental Mathematics 2(1), 1993.
5. A. I. Bobenko and B. A. Springborn, "A Discrete Laplace–Beltrami Operator for Simplicial
   Surfaces", Discrete & Computational Geometry 38(4), 2007.
6. N. Sharp, Y. Soliman and K. Crane, "Navigating Intrinsic Triangulations", ACM Transactions on
   Graphics 38(4), 2019.
7. Y. Saad, "Iterative Methods for Sparse Linear Systems", 2nd edition, SIAM, 2003.
8. A. George and J. W. H. Liu, "Computer Solution of Large Sparse Positive Definite Systems",
   Prentice-Hall, 1981.
9. K. Crane, C. Weischedel and M. Wardetzky, "Geodesics in Heat: A New Approach to Computing
   Distance Based on Heat Flow", ACM Transactions on Graphics 32(5), 2013.
10. A. Neumaier, "Rundungsfehleranalyse einiger Verfahren zur Summation endlicher Summen",
    Zeitschrift für Angewandte Mathematik und Mechanik 54, 1974.
11. D. A. Green, "A colour scheme for the display of astronomical intensity images", Bulletin of
    the Astronomical Society of India 39, 2011.
