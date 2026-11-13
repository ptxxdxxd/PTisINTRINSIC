"""Typed access to the JSON fixtures written by scripts/export-fixtures.ts."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import numpy as np
from numpy.typing import NDArray

FIXTURE_DIRECTORY = Path(__file__).resolve().parent.parent / "fixtures"

# Unit roundoff of binary64.
UNIT_ROUNDOFF = 2.0**-53


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
    for path in sorted(FIXTURE_DIRECTORY.glob("*.json")):
        if path.name == "needles.json":
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
