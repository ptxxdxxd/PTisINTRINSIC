"""Typed access to the JSON fixtures written by scripts/export-fixtures.ts."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

import numpy as np
from numpy.typing import NDArray

FIXTURE_DIRECTORY = Path(__file__).resolve().parent.parent / "fixtures"

# Unit roundoff of binary64.
UNIT_ROUNDOFF = 2.0**-53


@dataclass(frozen=True)
class GeodesicCase:
    sources: tuple[int, ...]
    distance: NDArray[np.float64] = field(repr=False)


@dataclass(frozen=True)
class MeshFixture:
    name: str
    embedded: bool
    faces: NDArray[np.int64]
    positions: NDArray[np.float64] | None
    face_edge_lengths: NDArray[np.float64]
    face_areas: NDArray[np.float64]
    corner_angles: NDArray[np.float64]
    is_boundary: NDArray[np.bool_]
    vertex_curvature: NDArray[np.float64]
    barycentric_areas: NDArray[np.float64]
    mixed_areas: NDArray[np.float64]
    laplacian: NDArray[np.float64] = field(repr=False)
    delaunay_flips: int = 0
    delaunay_faces: NDArray[np.int64] = field(default_factory=lambda: np.empty((0, 3), np.int64))
    delaunay_face_edge_lengths: NDArray[np.float64] = field(
        default_factory=lambda: np.empty((0, 3), np.float64)
    )
    delaunay_laplacian: NDArray[np.float64] = field(
        default_factory=lambda: np.empty((0, 3), np.float64)
    )
    dirichlet_boundary_values: NDArray[np.float64] = field(
        default_factory=lambda: np.empty(0, np.float64)
    )
    dirichlet_solution: NDArray[np.float64] = field(default_factory=lambda: np.empty(0, np.float64))
    spectrum_values: NDArray[np.float64] = field(default_factory=lambda: np.empty(0, np.float64))
    spectrum_vectors: NDArray[np.float64] = field(
        default_factory=lambda: np.empty((0, 0), np.float64)
    )
    geodesic_time: float = 0.0
    geodesic_cases: tuple[GeodesicCase, ...] = ()

    @property
    def vertex_count(self) -> int:
        return int(self.is_boundary.size)

    def __repr__(self) -> str:
        return self.name


@dataclass(frozen=True)
class Needle:
    sides: tuple[float, float, float]
    area: float
    angles: tuple[float, float, float]


def _floats(values: Any) -> NDArray[np.float64]:
    return np.asarray(values, dtype=np.float64)


def _read(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def mesh_fixtures() -> list[MeshFixture]:
    fixtures = []
    # Top level only: the exports directory holds files in other formats.
    for path in sorted(FIXTURE_DIRECTORY.glob("*.json")):
        if path.name in ("needles.json", "symmetric-matrices.json"):
            continue
        raw = _read(path)
        results = raw["results"]
        positions = raw.get("positions")
        fixtures.append(
            MeshFixture(
                name=cast(str, raw["name"]),
                embedded=raw["kind"] == "embedded",
                faces=np.asarray(raw["faces"], dtype=np.int64),
                positions=None if positions is None else _floats(positions),
                face_edge_lengths=_floats(raw["faceEdgeLengths"]),
                face_areas=_floats(results["faceAreas"]),
                corner_angles=_floats(results["cornerAngles"]),
                is_boundary=np.asarray(results["isBoundary"], dtype=np.bool_),
                vertex_curvature=_floats(results["vertexCurvature"]),
                barycentric_areas=_floats(results["barycentricAreas"]),
                mixed_areas=_floats(results["mixedAreas"]),
                laplacian=_floats(results["laplacian"]),
                delaunay_flips=int(results["delaunay"]["flips"]),
                delaunay_faces=np.asarray(results["delaunay"]["faces"], dtype=np.int64),
                delaunay_face_edge_lengths=_floats(results["delaunay"]["faceEdgeLengths"]),
                delaunay_laplacian=_floats(results["delaunay"]["laplacian"]),
                dirichlet_boundary_values=_floats(results["dirichlet"]["boundaryValues"]),
                dirichlet_solution=_floats(results["dirichlet"]["solution"]),
                spectrum_values=_floats(results["spectrum"]["values"]),
                spectrum_vectors=_floats(results["spectrum"]["vectors"]),
                geodesic_time=float(results["geodesics"]["time"]),
                geodesic_cases=tuple(
                    GeodesicCase(
                        sources=tuple(int(v) for v in case["sources"]),
                        distance=_floats(case["distance"]),
                    )
                    for case in results["geodesics"]["cases"]
                ),
            )
        )
    return fixtures


def needles() -> list[Needle]:
    if not (FIXTURE_DIRECTORY / "needles.json").is_file():
        return []
    return [
        Needle(
            sides=cast(tuple[float, float, float], tuple(item["sides"])),
            area=float(item["area"]),
            angles=cast(tuple[float, float, float], tuple(item["angles"])),
        )
        for item in _read(FIXTURE_DIRECTORY / "needles.json")
    ]


@dataclass(frozen=True)
class SymmetricCase:
    matrix: NDArray[np.float64]
    values: NDArray[np.float64]
    # Row k is the eigenvector for values[k].
    vectors: NDArray[np.float64]

    def __repr__(self) -> str:
        return f"n={self.values.size}"


def symmetric_cases() -> list[SymmetricCase]:
    path = FIXTURE_DIRECTORY / "symmetric-matrices.json"
    if not path.is_file():
        return []
    return [
        SymmetricCase(
            matrix=_floats(item["matrix"]),
            values=_floats(item["values"]),
            vectors=_floats(item["vectors"]),
        )
        for item in _read(path)
    ]
