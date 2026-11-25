// The map's top-down WebGL view (three.js), loaded on first use: import this module with `import()`.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';

import { at } from './map';

/** Entities as the backend sends them: 16 bytes each, x, y, z (f32, metres, Z-up) and the model index (u32). */
export type MapPoints = { positions: Float32Array; models: Uint32Array; count: number };

export function readPoints(buffer: ArrayBuffer): MapPoints {
  const count = Math.floor(buffer.byteLength / 16);
  const view = new DataView(buffer);
  const positions = new Float32Array(count * 3);
  const models = new Uint32Array(count);
  for (let index = 0; index < count; index++) {
    const at = index * 16;
    positions[index * 3] = view.getFloat32(at, true);
    positions[index * 3 + 1] = view.getFloat32(at + 4, true);
    positions[index * 3 + 2] = view.getFloat32(at + 8, true);
    models[index] = view.getUint32(at + 12, true);
  }
  return { positions, models, count };
}

/** The accent gradient (magenta, violet, cyan) by height, low to high. */
const LOW = new THREE.Color('#ff4fa3');
const MID = new THREE.Color('#a855f7');
const HIGH = new THREE.Color('#38d6ff');
const DIM = new THREE.Color('#383838');
const LIT = new THREE.Color('#f0f0f0');

function heightColour(z: number, low: number, high: number, out: THREE.Color): THREE.Color {
  const t = Math.min(Math.max((z - low) / Math.max(high - low, 1), 0), 1);
  return t < 0.5 ? out.copy(LOW).lerp(MID, t * 2) : out.copy(MID).lerp(HIGH, (t - 0.5) * 2);
}

export type MapHandle = {
  /** Highlights the entities whose model is in `models` (null: every entity by height). */
  highlight: (models: ReadonlySet<number> | null) => void;
  /** Centres the view on `x, y` (metres) at about `span` metres across. */
  focus: (x: number, y: number, span: number) => void;
  /** Shows or hides the interiors' squares. */
  showInteriors: (shown: boolean) => void;
  /** Marks one entity (or none). */
  mark: (index: number | null) => void;
  dispose: () => void;
};

/** A 64 m grid of entity indices, to find the one under the pointer. */
function spatialGrid(points: MapPoints): Map<string, number[]> {
  const grid = new Map<string, number[]>();
  for (let index = 0; index < points.count; index++) {
    const key = `${Math.floor(at(points.positions, index * 3) / 64)},${Math.floor(at(points.positions, index * 3 + 1) / 64)}`;
    const cell = grid.get(key);
    if (cell) cell.push(index);
    else grid.set(key, [index]);
  }
  return grid;
}

/**
 * Renders `points` from above in `host`: north up, drag to pan, wheel to zoom at the pointer; `interiors` (x, y pairs)
 * as white squares above them. `onPick` gets the entity nearest a click (within a few pixels), or null.
 */
export function mountMap(
  host: HTMLElement,
  points: MapPoints,
  interiors: Float32Array,
  onPick: (index: number | null) => void,
): MapHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#121212');

  // Heights from the 2nd to the 98th percentile, so a few towers and caves do not flatten the gradient.
  const heights = Array.from({ length: Math.min(points.count, 20000) }, (_, step) => {
    const index = Math.floor((step * points.count) / Math.min(points.count, 20000));
    return at(points.positions, index * 3 + 2);
  }).sort((a, b) => a - b);
  const low = heights[Math.floor(heights.length * 0.02)] ?? 0;
  const high = heights[Math.floor(heights.length * 0.98)] ?? 100;

  const flat = new Float32Array(points.count * 3);
  for (let index = 0; index < points.count; index++) {
    flat[index * 3] = at(points.positions, index * 3);
    flat[index * 3 + 1] = at(points.positions, index * 3 + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(flat, 3));
  const colours = new Float32Array(points.count * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const material = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true });
  scene.add(new THREE.Points(geometry, material));

  const interiorPositions = new Float32Array((interiors.length / 2) * 3);
  for (let index = 0; index < interiors.length / 2; index++) {
    interiorPositions[index * 3] = at(interiors, index * 2);
    interiorPositions[index * 3 + 1] = at(interiors, index * 2 + 1);
    interiorPositions[index * 3 + 2] = 0.5;
  }
  const interiorGeometry = new THREE.BufferGeometry();
  interiorGeometry.setAttribute('position', new THREE.BufferAttribute(interiorPositions, 3));
  const interiorMaterial = new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, color: '#f0f0f0' });
  const interiorLayer = new THREE.Points(interiorGeometry, interiorMaterial);
  interiorLayer.renderOrder = 1;
  scene.add(interiorLayer);

  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1, 32),
    new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false }),
  );
  marker.visible = false;
  marker.renderOrder = 1;
  scene.add(marker);

  geometry.computeBoundingBox();
  const box =
    geometry.boundingBox ?? new THREE.Box3(new THREE.Vector3(-1000, -1000, 0), new THREE.Vector3(1000, 1000, 0));
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  camera.up.set(0, 1, 0);
  camera.position.set(centre.x, centre.y, 5);
  camera.lookAt(centre.x, centre.y, 0);

  const controls = new MapControls(camera, renderer.domElement);
  controls.enableRotate = false;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.target.set(centre.x, centre.y, 0);
  controls.minZoom = 0.05;
  controls.maxZoom = 400;

  let span = Math.max(size.x, size.y, 100) * 1.05;
  function resize() {
    const { clientWidth, clientHeight } = host;
    if (clientWidth === 0 || clientHeight === 0) return;
    renderer.setSize(clientWidth, clientHeight);
    const aspect = clientWidth / clientHeight;
    const half = span / 2;
    camera.left = -half * Math.max(aspect, 1);
    camera.right = half * Math.max(aspect, 1);
    camera.top = half / Math.min(aspect, 1);
    camera.bottom = -half / Math.min(aspect, 1);
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  function paint(models: ReadonlySet<number> | null) {
    const colour = new THREE.Color();
    for (let index = 0; index < points.count; index++) {
      if (models === null) heightColour(at(points.positions, index * 3 + 2), low, high, colour);
      else colour.copy(models.has(at(points.models, index)) ? LIT : DIM);
      colours[index * 3] = colour.r;
      colours[index * 3 + 1] = colour.g;
      colours[index * 3 + 2] = colour.b;
    }
    const attribute = geometry.getAttribute('color');
    attribute.needsUpdate = true;
  }
  paint(null);

  const grid = spatialGrid(points);
  /** Metres per pixel at the current zoom. */
  const metresPerPixel = () => (camera.right - camera.left) / camera.zoom / Math.max(host.clientWidth, 1);

  let down: { x: number; y: number } | null = null;
  function onPointerDown(event: PointerEvent) {
    down = { x: event.clientX, y: event.clientY };
  }
  function onPointerUp(event: PointerEvent) {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector3(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
      0,
    ).unproject(camera);
    const reach = metresPerPixel() * 6;
    let best: number | null = null;
    let bestDistance = reach;
    const cells = Math.ceil(reach / 64);
    const cx = Math.floor(ndc.x / 64);
    const cy = Math.floor(ndc.y / 64);
    for (let dx = -cells; dx <= cells; dx++) {
      for (let dy = -cells; dy <= cells; dy++) {
        for (const index of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const distance = Math.hypot(
            at(points.positions, index * 3) - ndc.x,
            at(points.positions, index * 3 + 1) - ndc.y,
          );
          if (distance < bestDistance) {
            bestDistance = distance;
            best = index;
          }
        }
      }
    }
    onPick(best);
  }
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  let frameId = 0;
  function render() {
    frameId = requestAnimationFrame(render);
    controls.update();
    // Points grow a little when zoomed in; the marker keeps its size on screen.
    material.size = Math.min(Math.max(1, camera.zoom * 0.5), 6);
    marker.scale.setScalar(metresPerPixel() * 10);
    renderer.render(scene, camera);
  }
  render();

  return {
    highlight: paint,
    focus(x, y, wanted) {
      controls.target.set(x, y, 0);
      camera.position.set(x, y, 5);
      camera.zoom = Math.min(Math.max(span / Math.max(wanted, 1), controls.minZoom), controls.maxZoom);
      camera.updateProjectionMatrix();
    },
    showInteriors(shown) {
      interiorLayer.visible = shown;
    },
    mark(index) {
      marker.visible = index !== null;
      if (index !== null) marker.position.set(at(points.positions, index * 3), at(points.positions, index * 3 + 1), 1);
    },
    dispose() {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      geometry.dispose();
      material.dispose();
      interiorGeometry.dispose();
      interiorMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      span = 0;
    },
  };
}
