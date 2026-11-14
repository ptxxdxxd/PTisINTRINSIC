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

  /** An independent copy, for algorithms that change the connectivity. */
  clone(): TriangleMesh {
    return new TriangleMesh(
      this.vertexCount,
      this.halfedgeVertex.slice(),
      this.halfedgeTwin.slice(),
      this.halfedgeEdge.slice(),
      this.edgeHalfedge.slice(),
      this.vertexHalfedge.slice(),
    );
  }

  /** The halfedge from one vertex to another, or -1 if they are not adjacent that way. */
  findHalfedge(from: number, to: number): number {
    for (const h of this.outgoingHalfedges(from)) {
      if (this.tipVertex(h) === to) return h;
    }
    return -1;
  }

  /**
   * Replaces interior edge e, the diagonal of the quadrilateral formed by its
   * two faces, with the other diagonal. Only the connectivity changes; new
   * edge lengths are the caller's business. The edge keeps its index.
   *
   * The result need not be a simplicial complex: two edges may join the same
   * pair of vertices, an edge may be a loop, and a face may use one vertex
   * twice. That is a Δ-complex, and the intrinsic Delaunay triangulation of
   * some meshes is only reachable through one (Bobenko and Springborn 2007;
   * Sharp, Soliman and Crane 2019). Such meshes cannot
   * be rebuilt with fromFaces; use validateConnectivity to check them.
   *
   * Returns false, changing nothing, when the edge is on the boundary or both
   * of its halfedges lie in one face (an endpoint of degree 1), where there is
   * no quadrilateral to flip.
   *
   * Before, with h0 = i→j in face f0 and h1 = j→i in face f1:
   *     f0 = (i, j, k),  f1 = (j, i, l)
   * after:
   *     f0 = (l, j, k),  f1 = (k, i, l),  edge e = k–l.
   */
  flipEdge(e: number): boolean {
    const h0 = this.edgeHalfedge[e];
    const h1 = this.halfedgeTwin[h0];
    if (h1 === -1 || halfedgeFace(h0) === halfedgeFace(h1)) return false;
    const vertex = this.halfedgeVertex;
    const twin = this.halfedgeTwin;
    const edge = this.halfedgeEdge;
    const i = vertex[h0];
    const j = vertex[h1];
    const h0n = nextHalfedge(h0);
    const h0p = prevHalfedge(h0);
    const h1n = nextHalfedge(h1);
    const h1p = prevHalfedge(h1);
    const k = vertex[h0p];
    const l = vertex[h1p];

    const f0 = 3 * halfedgeFace(h0);
    const f1 = 3 * halfedgeFace(h1);
    // The four outer halfedges keep their direction, edge and twin but move to
    // new slots: l→j, j→k in f0 and k→i, i→l in f1. Two of them can be twins
    // of each other (the two faces share a second edge), so twins are looked
    // up by their new slot.
    const outer = [
      { from: h1p, to: f0, tail: l },
      { from: h0n, to: f0 + 1, tail: j },
      { from: h0p, to: f1, tail: k },
      { from: h1n, to: f1 + 1, tail: i },
    ].map((m) => ({ ...m, edge: edge[m.from], twin: twin[m.from] }));
    const movedTo = new Map(outer.map((m) => [m.from, m.to]));

    for (const m of outer) {
      const t = m.twin === -1 ? -1 : (movedTo.get(m.twin) ?? m.twin);
      vertex[m.to] = m.tail;
      edge[m.to] = m.edge;
      twin[m.to] = t;
      if (t !== -1) twin[t] = m.to;
      this.edgeHalfedge[m.edge] = m.to;
    }
    vertex[f0 + 2] = k;
    vertex[f1 + 2] = l;
    edge[f0 + 2] = e;
    edge[f1 + 2] = e;
    twin[f0 + 2] = f1 + 2;
    twin[f1 + 2] = f0 + 2;
    this.edgeHalfedge[e] = f0 + 2;

    // Repoint any vertex whose stored halfedge moved or disappeared. Boundary
    // vertices only ever store an outer (boundary) halfedge, which moved. The
    // four corners need not be distinct, and each must be repointed once.
    for (const v of new Set([i, j, k, l])) {
      const stored = this.vertexHalfedge[v];
      const moved = movedTo.get(stored);
      if (moved !== undefined) this.vertexHalfedge[v] = moved;
      else if (stored === h0 || stored === h1) this.vertexHalfedge[v] = v === i ? f1 + 1 : f0 + 1;
    }
    return true;
  }

  /**
   * Checks every halfedge invariant; throws MeshError describing the first
   * one broken. Meant for tests and debugging: fromFaces already guarantees
   * these, and flipEdge preserves them. Unlike fromFaces it accepts Δ-complex
   * connectivity (parallel edges, loops, faces that repeat a vertex).
   */
  validateConnectivity(): void {
    const halfedges = this.halfedgeVertex.length;
    const fail = (message: string): never => {
      throw new MeshError(message);
    };
    const halfedgesPerEdge = new Int32Array(this.edgeCount);
    const corners = new Int32Array(this.vertexCount);
    for (let h = 0; h < halfedges; h++) {
      const v = this.halfedgeVertex[h];
      if (!(v >= 0 && v < this.vertexCount)) fail(`halfedge ${h} has vertex ${v} out of range`);
      corners[v]++;
      const e = this.halfedgeEdge[h];
      if (!(e >= 0 && e < this.edgeCount)) fail(`halfedge ${h} has edge ${e} out of range`);
      halfedgesPerEdge[e]++;
      const t = this.halfedgeTwin[h];
      if (t === -1) continue;
      if (t === h || this.halfedgeTwin[t] !== h) fail(`halfedge ${h} and its twin ${t} disagree`);
      if (this.halfedgeEdge[t] !== e) fail(`halfedge ${h} and its twin lie on different edges`);
      if (this.halfedgeVertex[t] !== this.tipVertex(h) || this.tipVertex(t) !== v) {
        fail(`halfedge ${h} and its twin do not run in opposite directions`);
      }
    }
    for (let e = 0; e < this.edgeCount; e++) {
      const h = this.edgeHalfedge[e];
      if (this.halfedgeEdge[h] !== e) fail(`edge ${e} points at a halfedge of another edge`);
      const expected = this.halfedgeTwin[h] === -1 ? 1 : 2;
      if (halfedgesPerEdge[e] !== expected) fail(`edge ${e} has ${halfedgesPerEdge[e]} halfedges`);
    }
    for (let v = 0; v < this.vertexCount; v++) {
      const h = this.vertexHalfedge[v];
      if (this.halfedgeVertex[h] !== v)
        fail(`vertex ${v} points at a halfedge it is not the tail of`);
      // Walking the fan from the stored halfedge must reach every corner at v.
      // That also catches a boundary vertex storing an interior halfedge: the
      // walk would stop at the boundary early.
      if (this.outgoingHalfedges(v).length !== corners[v]) {
        fail(`the faces around vertex ${v} do not form a single fan`);
      }
    }
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
      // Guards against looping forever on corrupted connectivity. A vertex can
      // have more corners than there are faces (a face of a Δ-complex may use
      // it twice), but never more than there are halfedges.
    } while (h !== -1 && h !== start && result.length < this.halfedgeVertex.length);
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
