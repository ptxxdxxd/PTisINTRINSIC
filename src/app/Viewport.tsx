import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { colorRamp, type ColorMapName } from './colormap.ts';
import type { Drawing } from './model.ts';

export interface ViewportProps {
  readonly drawing: Drawing;
  /** One value per vertex; NaN is drawn grey. */
  readonly values: Float64Array;
  readonly map: ColorMapName;
  readonly range: readonly [number, number];
  /** Spacing of contour lines in units of the values; 0 for none. */
  readonly contourSpacing: number;
  readonly wireframe: boolean;
  readonly sources: readonly number[];
  readonly selected: number | null;
  readonly onPick: (vertex: number, add: boolean) => void;
  readonly description: string;
  /** The camera is re-aimed when this changes, and otherwise left where the user put it. */
  readonly viewKey: string;
}

const VERTEX_SHADER = /* glsl */ `
  attribute float scalar;
  attribute float defined;
  varying float vScalar;
  varying float vDefined;
  varying vec3 vNormal;
  varying vec3 vToCamera;
  void main() {
    vScalar = scalar;
    vDefined = defined;
    vNormal = normalMatrix * normal;
    vec4 inView = modelViewMatrix * vec4(position, 1.0);
    vToCamera = -inView.xyz;
    gl_Position = projectionMatrix * inView;
  }
`;

// Colour comes from a lookup texture. Contour lines are drawn where the value
// crosses a multiple of the spacing, with screen-space derivatives keeping
// them one to two pixels wide at any zoom.
const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D ramp;
  uniform float low;
  uniform float high;
  uniform float spacing;
  uniform vec3 contourColor;
  uniform vec3 undefinedColor;
  varying float vScalar;
  varying float vDefined;
  varying vec3 vNormal;
  varying vec3 vToCamera;
  void main() {
    float t = clamp((vScalar - low) / max(high - low, 1e-30), 0.0, 1.0);
    vec3 color = texture2D(ramp, vec2(t, 0.5)).rgb;
    if (spacing > 0.0) {
      float level = vScalar / spacing;
      float distanceToLine = abs(fract(level - 0.5) - 0.5) / max(fwidth(level), 1e-6);
      color = mix(color, contourColor, 0.6 * (1.0 - smoothstep(0.5, 1.5, distanceToLine)));
    }
    color = mix(undefinedColor, color, step(0.5, vDefined));
    float facing = abs(dot(normalize(vNormal), normalize(vToCamera)));
    gl_FragColor = vec4(color * (0.6 + 0.4 * facing), 1.0);
    #include <colorspace_fragment>
  }
`;

interface Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly material: THREE.ShaderMaterial;
  readonly surface: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly wires: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  readonly markers: THREE.Group;
  readonly ramps: Record<ColorMapName, THREE.DataTexture>;
  radius: number;
  /** Camera distance at which the surface's bounding sphere just fits the canvas. */
  fit: number;
  frames: number;
  /** Handle of the animation frame waiting to draw, or 0. */
  pendingFrame: number;
  render: () => void;
}

function rampTexture(map: ColorMapName): THREE.DataTexture {
  const texture = new THREE.DataTexture(colorRamp(map), 256, 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createStage(canvas: HTMLCanvasElement): Stage {
  // Transparent, so the page's own background shows behind the surface in
  // both colour schemes.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearAlpha(0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  const ramps = { sequential: rampTexture('sequential'), diverging: rampTexture('diverging') };
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.DoubleSide,
    uniforms: {
      ramp: { value: ramps.diverging },
      low: { value: 0 },
      high: { value: 1 },
      spacing: { value: 0 },
      contourColor: { value: new THREE.Color(0x101418) },
      undefinedColor: { value: new THREE.Color(0x8a9199) },
    },
  });
  const surface = new THREE.Mesh(new THREE.BufferGeometry(), material);
  const wires = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x101418, transparent: true, opacity: 0.28 }),
  );
  const markers = new THREE.Group();
  scene.add(surface, wires, markers);

  const stage: Stage = {
    renderer,
    scene,
    camera,
    controls,
    material,
    surface,
    wires,
    markers,
    ramps,
    radius: 1,
    fit: 1,
    frames: 0,
    pendingFrame: 0,
    render: () => undefined,
  };
  // Draw only when something changed, at most once per animation frame.
  stage.render = () => {
    if (stage.pendingFrame !== 0) return;
    stage.pendingFrame = requestAnimationFrame(() => {
      stage.pendingFrame = 0;
      renderer.render(scene, camera);
      stage.frames++;
      canvas.dataset.frames = String(stage.frames);
    });
  };
  controls.addEventListener('change', stage.render);
  return stage;
}

/** Distance from which a sphere of the given radius fits inside the narrower of the two view angles. */
function fitDistance(camera: THREE.PerspectiveCamera, radius: number): number {
  const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
  const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
  return (0.88 * radius) / Math.sin(Math.min(vertical, horizontal));
}

function disposeStage(stage: Stage): void {
  cancelAnimationFrame(stage.pendingFrame);
  stage.controls.dispose();
  stage.surface.geometry.dispose();
  stage.wires.geometry.dispose();
  stage.wires.material.dispose();
  stage.material.dispose();
  for (const texture of Object.values(stage.ramps)) texture.dispose();
  clearMarkers(stage);
  stage.renderer.dispose();
}

function clearMarkers(stage: Stage): void {
  for (const child of [...stage.markers.children]) {
    const marker = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
    marker.geometry.dispose();
    marker.material.dispose();
    stage.markers.remove(marker);
  }
}

export function Viewport(props: ViewportProps) {
  const { drawing, values, map, range, contourSpacing, wireframe, sources, selected, onPick } =
    props;
  const { viewKey } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const framed = useRef<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);

  // Renderer, camera and controls live as long as the component.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let stage: Stage;
    try {
      stage = createStage(canvas);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      queueMicrotask(() => {
        setFailure(`WebGL is not available (${reason}). The numbers alongside are still computed.`);
      });
      return;
    }
    stageRef.current = stage;

    const resize = () => {
      const { clientWidth, clientHeight } = canvas;
      if (clientWidth === 0 || clientHeight === 0) return;
      stage.renderer.setSize(clientWidth, clientHeight, false);
      stage.camera.aspect = clientWidth / clientHeight;
      stage.camera.updateProjectionMatrix();
      // Keep the surface the same fraction of the canvas: move the camera
      // along its line of sight by the change in fitting distance.
      const fit = fitDistance(stage.camera, stage.radius);
      const offset = stage.camera.position.clone().sub(stage.controls.target);
      stage.camera.position.copy(stage.controls.target).add(offset.multiplyScalar(fit / stage.fit));
      stage.fit = fit;
      stage.controls.update();
      stage.render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // A press and release in the same place is a pick; anything else is a drag.
    let down: { x: number; y: number } | null = null;
    const onDown = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY };
    };
    const onUp = (event: PointerEvent) => {
      if (down === null || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
      const box = canvas.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - box.left) / box.width) * 2 - 1,
        1 - ((event.clientY - box.top) / box.height) * 2,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(pointer, stage.camera);
      const hits = ray.intersectObject(stage.surface);
      if (hits.length === 0) return;
      const hit = hits[0];
      const face = hit.face;
      if (!face) return;
      const position = stage.surface.geometry.getAttribute('position');
      let nearest = face.a;
      let best = Infinity;
      for (const v of [face.a, face.b, face.c]) {
        const d = new THREE.Vector3().fromBufferAttribute(position, v).distanceTo(hit.point);
        if (d < best) [nearest, best] = [v, d];
      }
      pick.current(nearest, event.shiftKey);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);

    return () => {
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      disposeStage(stage);
      stageRef.current = null;
    };
  }, []);

  // New surface: rebuild the geometry and frame it.
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    const n = drawing.positions.length / 3;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(drawing.positions), 3),
    );
    geometry.setAttribute('scalar', new THREE.BufferAttribute(new Float32Array(n), 1));
    geometry.setAttribute('defined', new THREE.BufferAttribute(new Float32Array(n), 1));
    geometry.setIndex(new THREE.BufferAttribute(drawing.faces, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    stage.surface.geometry.dispose();
    stage.surface.geometry = geometry;

    const wires = new THREE.BufferGeometry();
    wires.setAttribute('position', geometry.getAttribute('position'));
    wires.setIndex(new THREE.BufferAttribute(drawing.edges, 1));
    stage.wires.geometry.dispose();
    stage.wires.geometry = wires;

    stage.render();
    // Changing a slider keeps the view; a different kind of surface re-aims it.
    if (framed.current === viewKey) return;
    framed.current = viewKey;
    const sphere = geometry.boundingSphere ?? new THREE.Sphere(new THREE.Vector3(), 1);
    stage.radius = sphere.radius;
    stage.fit = fitDistance(stage.camera, sphere.radius);
    stage.controls.target.copy(sphere.center);
    stage.camera.position
      .copy(sphere.center)
      .add(new THREE.Vector3(0.95, -1.35, 1.05).normalize().multiplyScalar(stage.fit));
    stage.camera.near = sphere.radius / 100;
    stage.camera.far = sphere.radius * 100;
    stage.camera.updateProjectionMatrix();
    stage.controls.update();
    stage.render();
  }, [drawing, viewKey]);

  // New field: refill the per-vertex attributes and the shader's settings.
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    const geometry = stage.surface.geometry;
    const scalar = geometry.getAttribute('scalar') as THREE.BufferAttribute | undefined;
    const defined = geometry.getAttribute('defined') as THREE.BufferAttribute | undefined;
    if (scalar === undefined || defined === undefined || scalar.count !== values.length) return;
    for (let v = 0; v < values.length; v++) {
      const ok = Number.isFinite(values[v]);
      scalar.setX(v, ok ? values[v] : 0);
      defined.setX(v, ok ? 1 : 0);
    }
    scalar.needsUpdate = true;
    defined.needsUpdate = true;
    // For tests and debugging: how many vertices carry a value right now.
    stage.renderer.domElement.dataset.defined = String(values.filter(Number.isFinite).length);
    const { uniforms } = stage.material;
    uniforms.ramp.value = stage.ramps[map];
    uniforms.low.value = range[0];
    uniforms.high.value = range[1];
    uniforms.spacing.value = contourSpacing;
    stage.wires.visible = wireframe;
    stage.render();
  }, [drawing, values, map, range, contourSpacing, wireframe]);

  // Markers at the sources (dark) and the inspected vertex (light).
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    clearMarkers(stage);
    const place = (vertex: number, color: number, scale: number) => {
      if (3 * vertex + 2 >= drawing.positions.length) return;
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.018 * scale * stage.radius, 16, 12),
        new THREE.MeshBasicMaterial({ color }),
      );
      marker.position.fromArray(drawing.positions, 3 * vertex);
      stage.markers.add(marker);
    };
    for (const v of sources) place(v, 0x0b0e11, 1.25);
    if (selected !== null) place(selected, 0xffffff, 0.9);
    stage.render();
  }, [drawing, sources, selected]);

  return (
    <div className="viewport">
      <canvas ref={canvasRef} role="img" aria-label={props.description} />
      {failure !== null && <p className="viewport-message">{failure}</p>}
    </div>
  );
}
