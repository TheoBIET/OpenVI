// The free-flying world view (three.js), loaded on first use: import this module with `import()`.
//
// The world is cut into square cells streamed around the camera: the nearest are asked for first (their models are
// exported by the backend the first time, then their manifest answers at once), the far ones are dropped. Every
// entity of the map also shows as a point, so the city stands in the distance before its cells arrive. Coordinates:
// glTF / three.js Y-up; RAGE world (x, y, z) is (x, z, -y) here.
import { convertFileSrc } from '@tauri-apps/api/core';
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

import { at, CELL } from './map';
import type { MapPoints } from './mapScene';
import { type LoadedModel, loadGlb } from './scene';

export type WorldStatus = {
  /** RAGE world position of the camera, metres. */
  x: number;
  y: number;
  z: number;
  /** Compass heading, degrees (0 north, 90 east). */
  heading: number;
  fps: number;
  /** Cells on screen, cells waiting, and the cell being fetched (null when idle). */
  loaded: number;
  waiting: number;
  fetching: string | null;
  error: string | null;
};

export type WorldHandle = {
  /** Hour of the day, 0 to 24: the sun, the sky, the light. */
  setTime: (hour: number) => void;
  setWater: (shown: boolean) => void;
  /** Flying speed, metres a second. */
  setSpeed: (speed: number) => void;
  /** How many rings of cells around the camera are loaded (1: 3×3, 2: 5×5…). */
  setDetail: (rings: number) => void;
  /** Moves the camera above RAGE `(x, y)`, looking north. */
  teleport: (x: number, y: number) => void;
  dispose: () => void;
};

type AssemblyPart = { glb: string; matrix: number[] };

function isPart(value: unknown): value is AssemblyPart {
  if (typeof value !== 'object' || value === null) return false;
  const glb: unknown = Reflect.get(value, 'glb');
  const matrix: unknown = Reflect.get(value, 'matrix');
  return typeof glb === 'string' && Array.isArray(matrix) && matrix.length === 16;
}

/** Largest side of a texture in the world view: a city block of full-size textures runs the GPU out of memory. */
const MAX_TEXTURE = 512;

/** Shrinks the textures of a loaded model to {@link MAX_TEXTURE}, before they reach the GPU. */
function shrink(model: LoadedModel): LoadedModel {
  const done = new Set<THREE.Texture>();
  model.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const own: unknown = object.material;
    const materials = Array.isArray(own) ? own : [own];
    for (const material of materials) {
      if (!(material instanceof THREE.Material)) continue;
      for (const value of Object.values(material)) {
        if (!(value instanceof THREE.Texture) || done.has(value)) continue;
        done.add(value);
        const image: unknown = value.image;
        if (!(image instanceof ImageBitmap || image instanceof HTMLImageElement)) continue;
        const scale = MAX_TEXTURE / Math.max(image.width, image.height);
        if (scale >= 1) continue;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
        if (image instanceof ImageBitmap) image.close();
        value.image = canvas;
        value.needsUpdate = true;
      }
    }
  });
  return model;
}

/** The ground height near RAGE `(x, y)`: the median height of the map's entities within 60 m, or 0. */
function groundNear(points: MapPoints, x: number, y: number): number {
  const heights: number[] = [];
  for (let index = 0; index < points.count; index++) {
    const dx = at(points.positions, index * 3) - x;
    const dy = at(points.positions, index * 3 + 1) - y;
    if (dx * dx + dy * dy < 3600) heights.push(at(points.positions, index * 3 + 2));
  }
  heights.sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)] ?? 0;
}

/**
 * Flies over the world in `host`. `points` are the map's entities (the distant city); `loadCell` returns the manifest
 * of cell `(column, row)`; `onStatus` gets the HUD's data a few times a second.
 */
export function mountWorld(
  host: HTMLElement,
  points: MapPoints,
  loadCell: (column: number, row: number) => Promise<string>,
  onStatus: (status: WorldStatus) => void,
  start: { x: number; y: number },
): WorldHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  host.appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.5, 30000);
  camera.rotation.order = 'YXZ';

  // Sky, sun and fog follow the hour.
  const sky = new Sky();
  sky.scale.setScalar(25000);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  scene.add(sun, sun.target);
  const ambient = new THREE.HemisphereLight(0xbfd8ff, 0x3a3328, 1.2);
  scene.add(ambient);
  scene.fog = new THREE.Fog(0xb8c8d8, 600, 4000);

  // The sea: a plane at sea level.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(60000, 60000),
    new THREE.MeshStandardMaterial({
      color: 0x1d5470,
      roughness: 0.25,
      metalness: 0.1,
      transparent: true,
      opacity: 0.88,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  // Just under sea level: low ground near the shore stays dry.
  water.position.y = -0.6;
  scene.add(water);

  // Every entity as a point: the city in the distance.
  const cloud = new Float32Array(points.count * 3);
  const tints = new Float32Array(points.count * 3);
  const tint = new THREE.Color();
  for (let index = 0; index < points.count; index++) {
    const x = at(points.positions, index * 3);
    const y = at(points.positions, index * 3 + 1);
    const z = at(points.positions, index * 3 + 2);
    cloud.set([x, z, -y], index * 3);
    tint.setHSL(0.6 - Math.min(Math.max(z / 300, 0), 1) * 0.45, 0.25, 0.42);
    tints.set([tint.r, tint.g, tint.b], index * 3);
  }
  const cloudGeometry = new THREE.BufferGeometry();
  cloudGeometry.setAttribute('position', new THREE.BufferAttribute(cloud, 3));
  cloudGeometry.setAttribute('color', new THREE.BufferAttribute(tints, 3));
  const cloudMaterial = new THREE.PointsMaterial({ size: 1.6, vertexColors: true, sizeAttenuation: true });
  // Points inside the loaded cells are hidden: the real models stand there.
  const hidden = { min: new THREE.Vector2(1, 1), max: new THREE.Vector2(0, 0) };
  cloudMaterial.onBeforeCompile = (shader) => {
    shader.uniforms['hideMin'] = { value: hidden.min };
    shader.uniforms['hideMax'] = { value: hidden.max };
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        ['uniform vec2 hideMin;', 'uniform vec2 hideMax;', 'varying float vHidden;', 'void main() {'].join('\n'),
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'vHidden = step(hideMin.x, position.x) * step(position.x, hideMax.x)',
          '  * step(hideMin.y, position.z) * step(position.z, hideMax.y);',
        ].join('\n'),
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      ['varying float vHidden;', 'void main() {', '  if (vHidden > 0.5) discard;'].join('\n'),
    );
  };
  scene.add(new THREE.Points(cloudGeometry, cloudMaterial));

  function setTime(hour: number) {
    const angle = ((hour - 6) / 12) * Math.PI;
    const elevation = Math.sin(angle);
    const direction = new THREE.Vector3(Math.cos(angle) * 0.9, elevation, -0.35).normalize();
    const uniforms = sky.material.uniforms;
    const set = (name: string, value: unknown) => {
      const uniform = uniforms[name];
      if (uniform) uniform.value = value;
    };
    set('sunPosition', direction.clone());
    set('turbidity', 6);
    set('rayleigh', elevation > 0 ? 1.6 : 0.4);
    set('mieCoefficient', 0.005);
    set('mieDirectionalG', 0.8);
    const day = Math.min(Math.max(elevation * 3, 0), 1);
    sun.intensity = 0.15 + day * 2.6;
    sun.color.setHSL(0.09 + day * 0.04, 0.6 - day * 0.4, 0.55 + day * 0.35);
    ambient.intensity = 0.25 + day * 1.1;
    renderer.toneMappingExposure = 0.35 + day * 0.4;
    const fog = new THREE.Color().setHSL(0.6, 0.25, 0.12 + day * 0.62);
    if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(fog);
    sunDirection.copy(direction);
  }
  const sunDirection = new THREE.Vector3(0, 1, 0);
  setTime(10.5);

  function resize() {
    const { clientWidth, clientHeight } = host;
    if (clientWidth === 0 || clientHeight === 0) return;
    renderer.setSize(clientWidth, clientHeight);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  // Flying: WASD / ZQSD / arrows to move, Space and C to rise and sink, Shift for speed; drag to look.
  let speed = 25;
  const pressed = new Set<string>();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement) return;
    pressed.add(event.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  };
  const onKeyUp = (event: KeyboardEvent) => pressed.delete(event.code);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  let dragging: { x: number; y: number } | null = null;
  const onDown = (event: PointerEvent) => {
    dragging = { x: event.clientX, y: event.clientY };
    renderer.domElement.setPointerCapture(event.pointerId);
    renderer.domElement.focus();
  };
  const onMove = (event: PointerEvent) => {
    if (!dragging) return;
    camera.rotation.y -= (event.clientX - dragging.x) * 0.0035;
    camera.rotation.x = Math.min(Math.max(camera.rotation.x - (event.clientY - dragging.y) * 0.0035, -1.5), 1.5);
    dragging = { x: event.clientX, y: event.clientY };
  };
  const onUp = () => {
    dragging = null;
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    speed = Math.min(Math.max(speed * (event.deltaY < 0 ? 1.15 : 1 / 1.15), 2), 400);
  };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('pointerup', onUp);
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

  function teleport(x: number, y: number) {
    camera.position.set(x, groundNear(points, x, y) + 35, -y);
    camera.rotation.set(-0.25, 0, 0);
  }
  teleport(start.x, start.y);

  // Streaming.
  let rings = 1;
  const cells = new Map<string, THREE.Group | 'loading'>();
  const templates = new Map<string, Promise<LoadedModel>>();
  let fetching: string | null = null;
  let error: string | null = null;
  /** Set when the view goes: work still in flight stops there. */
  const life = { disposed: false };
  const gone = () => life.disposed;

  async function buildCell(key: string, column: number, row: number) {
    const manifest = await loadCell(column, row);
    if (gone()) return;
    const response = await fetch(convertFileSrc(manifest));
    const json: unknown = await response.json();
    const models: unknown = typeof json === 'object' && json !== null ? Reflect.get(json, 'models') : null;
    const group = new THREE.Group();
    if (gone() || !cells.has(key)) return;
    // The cell shows at once and fills in as its models arrive.
    cells.set(key, group);
    scene.add(group);
    hideLoaded();
    if (!Array.isArray(models)) return;
    // Placements by model: each model is loaded once (a few at a time, for every cell together), then placed.
    const byModel = new Map<string, number[][]>();
    for (const part of models.filter(isPart)) {
      byModel.set(part.glb, [...(byModel.get(part.glb) ?? []), part.matrix]);
    }
    // Not awaited: the next cell is fetched while these models load.
    void Promise.all(
      [...byModel].map(async ([glb, matrices]) => {
        let template = templates.get(glb);
        if (!template) {
          template = queued(() => loadGlb(glb, []).then(shrink));
          templates.set(glb, template);
        }
        const loaded = await template.catch(() => null);
        // The cell may have been dropped meanwhile.
        if (!loaded || gone() || cells.get(key) !== group) return;
        // One instanced mesh per mesh of the model, for all its placements in the cell: a draw call each, not one
        // per placement (a block has thousands).
        loaded.scene.updateMatrixWorld(true);
        const placements = matrices.map((matrix) => new THREE.Matrix4().fromArray(matrix));
        loaded.scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh) return;
          const geometry: unknown = object.geometry;
          const material: unknown = object.material;
          if (!(geometry instanceof THREE.BufferGeometry)) return;
          const materials = Array.isArray(material) ? material : [material];
          if (!materials.every((item): item is THREE.Material => item instanceof THREE.Material)) return;
          const instanced = new THREE.InstancedMesh(
            geometry,
            Array.isArray(material) ? materials : materials[0],
            placements.length,
          );
          const local = object.matrixWorld;
          placements.forEach((placement, index) => {
            instanced.setMatrixAt(index, new THREE.Matrix4().multiplyMatrices(placement, local));
          });
          instanced.instanceMatrix.needsUpdate = true;
          instanced.computeBoundingSphere();
          group.add(instanced);
        });
      }),
    );
  }

  /** Model loads in flight, and those waiting: a city block holds hundreds of models, and loading them all at once
   * runs the view out of memory. */
  let running = 0;
  const waiting: (() => void)[] = [];
  function queued<T>(job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        running++;
        job()
          .then(resolve, reject)
          .finally(() => {
            running--;
            waiting.shift()?.();
          });
      };
      if (running < 4) start();
      else waiting.push(start);
    });
  }

  /** Fetches the nearest missing cell, one at a time; drops the far ones. */
  async function stream() {
    if (fetching || gone()) return;
    const column = Math.floor(camera.position.x / CELL);
    const row = Math.floor(-camera.position.z / CELL);
    const wanted: [number, number, number][] = [];
    for (let dx = -rings; dx <= rings; dx++) {
      for (let dy = -rings; dy <= rings; dy++) wanted.push([column + dx, row + dy, dx * dx + dy * dy]);
    }
    for (const [key, value] of cells) {
      const [c, r] = key.split(',').map(Number);
      if (c === undefined || r === undefined) continue;
      if (Math.abs(c - column) > rings + 1 || Math.abs(r - row) > rings + 1) {
        if (value !== 'loading') scene.remove(value);
        cells.delete(key);
      }
    }
    const next = wanted.sort((a, b) => a[2] - b[2]).find(([c, r]) => !cells.has(`${c},${r}`));
    if (!next) return;
    const key = `${next[0]},${next[1]}`;
    cells.set(key, 'loading');
    fetching = key;
    try {
      await buildCell(key, next[0], next[1]);
      error = null;
    } catch (failure) {
      error = String(failure);
      cells.delete(key);
    } finally {
      fetching = null;
    }
  }
  /** The extent of the loaded cells, where the points give way to the models. */
  function hideLoaded() {
    const keys = [...cells].filter(([, value]) => value !== 'loading').map(([key]) => key.split(',').map(Number));
    if (keys.length === 0) {
      hidden.min.set(1, 1);
      hidden.max.set(0, 0);
      return;
    }
    const columns = keys.map(([column]) => column ?? 0);
    const rows = keys.map(([, row]) => row ?? 0);
    // three.js x is RAGE x; three.js z is minus RAGE y.
    hidden.min.set(Math.min(...columns) * CELL, -(Math.max(...rows) + 1) * CELL);
    hidden.max.set((Math.max(...columns) + 1) * CELL, -Math.min(...rows) * CELL);
  }

  const streamer = window.setInterval(() => void stream(), 300);

  let frameId = 0;
  let last = performance.now();
  let frames = 0;
  let fps = 0;
  let fpsAt = last;
  let statusAt = 0;
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  function render(now: number) {
    frameId = requestAnimationFrame(render);
    const delta = Math.min((now - last) / 1000, 0.1);
    last = now;
    const step = speed * delta * (pressed.has('ShiftLeft') || pressed.has('ShiftRight') ? 4 : 1);
    camera.getWorldDirection(forward);
    right.crossVectors(forward, camera.up).normalize();
    const move = (keys: string[]) => keys.some((key) => pressed.has(key));
    if (move(['KeyW', 'KeyZ', 'ArrowUp'])) camera.position.addScaledVector(forward, step);
    if (move(['KeyS', 'ArrowDown'])) camera.position.addScaledVector(forward, -step);
    if (move(['KeyD', 'ArrowRight'])) camera.position.addScaledVector(right, step);
    if (move(['KeyA', 'KeyQ', 'ArrowLeft'])) camera.position.addScaledVector(right, -step);
    if (move(['Space', 'KeyE'])) camera.position.y += step;
    if (move(['KeyC', 'ControlLeft'])) camera.position.y -= step;
    sun.position.copy(camera.position).addScaledVector(sunDirection, 500);
    sun.target.position.copy(camera.position);
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
    frames++;
    if (now - fpsAt > 1000) {
      fps = Math.round((frames * 1000) / (now - fpsAt));
      frames = 0;
      fpsAt = now;
    }
    if (now - statusAt > 250) {
      statusAt = now;
      const heading = ((((-camera.rotation.y * 180) / Math.PI) % 360) + 360) % 360;
      let loaded = 0;
      for (const value of cells.values()) if (value !== 'loading') loaded++;
      onStatus({
        x: camera.position.x,
        y: -camera.position.z,
        z: camera.position.y,
        heading,
        fps,
        loaded,
        waiting: (rings * 2 + 1) ** 2 - loaded,
        fetching,
        error,
      });
    }
  }
  frameId = requestAnimationFrame(render);

  return {
    setTime,
    setWater(shown) {
      water.visible = shown;
    },
    setSpeed(next) {
      speed = next;
    },
    setDetail(next) {
      rings = Math.min(Math.max(Math.round(next), 1), 4);
    },
    teleport,
    dispose() {
      life.disposed = true;
      cancelAnimationFrame(frameId);
      window.clearInterval(streamer);
      observer.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      cloudGeometry.dispose();
      cloudMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
