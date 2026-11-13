/**
 * Triangle mesh connectivity as an array-based halfedge structure.
 *
 * Halfedge h = 3f + c belongs to face f and runs from the vertex at corner c to
 * the vertex at corner (c + 1) mod 3. Next, previous and face are therefore
 * arithmetic, and only three integers are stored per halfedge: its tail vertex,
 * its twin, and its undirected edge. A halfedge on the boundary has twin -1.
 *
 * Construction validates the input: faces must be consistently oriented, every
 * edge must have one or two faces, every vertex must belong to a face, and the
 * faces around each vertex must form a single fan (no "bow-tie" vertices).
 */
export class MeshError extends Error {
  override name = 'MeshError';
}

export function nextHalfedge(h: number): number {
  return h % 3 === 2 ? h - 2 : h + 1;
}

export function prevHalfedge(h: number): number {
  return h % 3 === 0 ? h + 2 : h - 1;
}

export function halfedgeFace(h: number): number {
  return Math.floor(h / 3);
}

export class TriangleMesh {
  readonly vertexCount: number;
  readonly faceCount: number;
  readonly edgeCount: number;
  /** Tail vertex of each halfedge. */
  readonly halfedgeVertex: Int32Array;
  /** Opposite halfedge, or -1 on the boundary. */
  readonly halfedgeTwin: Int32Array;
  /** Undirected edge of each halfedge. */
  readonly halfedgeEdge: Int32Array;
  /** One halfedge of each edge. */
  readonly edgeHalfedge: Int32Array;
  /**
   * One outgoing halfedge of each vertex. For a boundary vertex this is its
   * outgoing boundary halfedge, so rotating with {@link nextOutgoing} from it
   * visits every incident face.
   */
  readonly vertexHalfedge: Int32Array;

  private constructor(
    vertexCount: number,
    halfedgeVertex: Int32Array,
    halfedgeTwin: Int32Array,
    halfedgeEdge: Int32Array,
    edgeHalfedge: Int32Array,
    vertexHalfedge: Int32Array,
  ) {
    this.vertexCount = vertexCount;
    this.faceCount = halfedgeVertex.length / 3;
    this.edgeCount = edgeHalfedge.length;
    this.halfedgeVertex = halfedgeVertex;
    this.halfedgeTwin = halfedgeTwin;
    this.halfedgeEdge = halfedgeEdge;
    this.edgeHalfedge = edgeHalfedge;
    this.vertexHalfedge = vertexHalfedge;
  }

  /**
   * Builds a mesh from a flat list of vertex-index triples.
   *
   * @throws MeshError if the faces do not describe an oriented 2-manifold,
   *   possibly with boundary.
   */
  static fromFaces(vertexCount: number, faces: ArrayLike<number>): TriangleMesh {
    if (!Number.isInteger(vertexCount) || vertexCount < 3) {
      throw new MeshError(`vertexCount must be an integer >= 3, got ${vertexCount}`);
    }
    if (faces.length === 0 || faces.length % 3 !== 0) {
      throw new MeshError(`faces must hold a positive multiple of 3 indices, got ${faces.length}`);
    }
    const halfedgeCount = faces.length;
    const halfedgeVertex = new Int32Array(halfedgeCount);
    for (let h = 0; h < halfedgeCount; h++) {
      const v = faces[h];
      if (!Number.isInteger(v) || v < 0 || v >= vertexCount) {
        throw new MeshError(`face ${halfedgeFace(h)} has vertex index ${v} out of range`);
      }
      halfedgeVertex[h] = v;
    }
    for (let f = 0; f < halfedgeCount / 3; f++) {
      const a = halfedgeVertex[3 * f];
      const b = halfedgeVertex[3 * f + 1];
      const c = halfedgeVertex[3 * f + 2];
      if (a === b || b === c || c === a) {
        throw new MeshError(`face ${f} repeats a vertex: (${a}, ${b}, ${c})`);
      }
    }

    const byDirectedEdge = new Map<number, number>();
    for (let h = 0; h < halfedgeCount; h++) {
      const tail = halfedgeVertex[h];
      const head = halfedgeVertex[nextHalfedge(h)];
      const key = tail * vertexCount + head;
      if (byDirectedEdge.has(key)) {
        throw new MeshError(
          `edge ${tail} -> ${head} appears twice in the same direction: the faces are ` +
            `inconsistently oriented or the edge has more than two faces`,
        );
      }
      byDirectedEdge.set(key, h);
    }

    const halfedgeTwin = new Int32Array(halfedgeCount);
    const halfedgeEdge = new Int32Array(halfedgeCount);
    const edgeList: number[] = [];
    for (let h = 0; h < halfedgeCount; h++) {
      const tail = halfedgeVertex[h];
      const head = halfedgeVertex[nextHalfedge(h)];
      const twin = byDirectedEdge.get(head * vertexCount + tail) ?? -1;
      halfedgeTwin[h] = twin;
      if (twin === -1 || h < twin) {
        halfedgeEdge[h] = edgeList.length;
        if (twin !== -1) halfedgeEdge[twin] = edgeList.length;
        edgeList.push(h);
      }
    }

    const vertexHalfedge = new Int32Array(vertexCount).fill(-1);
    const boundaryOutgoing = new Uint8Array(vertexCount);
    const corners = new Int32Array(vertexCount);
    for (let h = 0; h < halfedgeCount; h++) {
      const v = halfedgeVertex[h];
      corners[v]++;
      if (halfedgeTwin[h] === -1) {
        if (boundaryOutgoing[v] === 1) {
          throw new MeshError(`vertex ${v} is on more than one boundary fan (non-manifold)`);
        }
        boundaryOutgoing[v] = 1;
        vertexHalfedge[v] = h;
      } else if (vertexHalfedge[v] === -1) {
        vertexHalfedge[v] = h;
      }
    }

    const mesh = new TriangleMesh(
      vertexCount,
      halfedgeVertex,
      halfedgeTwin,
      halfedgeEdge,
      Int32Array.from(edgeList),
      vertexHalfedge,
    );

    for (let v = 0; v < vertexCount; v++) {
      if (vertexHalfedge[v] === -1) {
        throw new MeshError(`vertex ${v} does not belong to any face`);
      }
      const fan = mesh.outgoingHalfedges(v).length;
      if (fan !== corners[v]) {
        throw new MeshError(
          `the ${corners[v]} faces around vertex ${v} do not form a single fan (non-manifold)`,
        );
      }
    }
    return mesh;
  }

  /** Head vertex of a halfedge. */
  tipVertex(h: number): number {
    return this.halfedgeVertex[nextHalfedge(h)];
  }

  /**
   * The next outgoing halfedge of the same vertex, turning across the edge
   * of prevHalfedge(h). Returns -1 when that edge is on the boundary.
   */
  nextOutgoing(h: number): number {
    return this.halfedgeTwin[prevHalfedge(h)];
  }

  /** Outgoing halfedges of a vertex in fan order, starting from vertexHalfedge. */
  outgoingHalfedges(v: number): number[] {
    const start = this.vertexHalfedge[v];
    const result: number[] = [];
    let h = start;
    do {
      result.push(h);
      h = this.nextOutgoing(h);
    } while (h !== -1 && h !== start && result.length <= this.faceCount);
    return result;
  }

  isBoundaryEdge(e: number): boolean {
    return this.halfedgeTwin[this.edgeHalfedge[e]] === -1;
  }

  isBoundaryVertex(v: number): boolean {
    return this.halfedgeTwin[this.vertexHalfedge[v]] === -1;
  }

  /** The two endpoints of an edge, in the direction of edgeHalfedge. */
  edgeVertices(e: number): [number, number] {
    const h = this.edgeHalfedge[e];
    return [this.halfedgeVertex[h], this.tipVertex(h)];
  }

  /** V - E + F. */
  eulerCharacteristic(): number {
    return this.vertexCount - this.edgeCount + this.faceCount;
  }

  /** Each boundary loop as its vertices in order. Empty for a closed surface. */
  boundaryLoops(): number[][] {
    const loops: number[][] = [];
    const seen = new Uint8Array(this.halfedgeVertex.length);
    for (let start = 0; start < this.halfedgeVertex.length; start++) {
      if (this.halfedgeTwin[start] !== -1 || seen[start] === 1) continue;
      const loop: number[] = [];
      let h = start;
      do {
        seen[h] = 1;
        loop.push(this.halfedgeVertex[h]);
        h = this.vertexHalfedge[this.tipVertex(h)];
      } while (h !== start);
      loops.push(loop);
    }
    return loops;
  }
}
