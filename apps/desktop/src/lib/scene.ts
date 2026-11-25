// three.js scene for the model view, loaded on first use: import this module with `import()`.
import { convertFileSrc } from '@tauri-apps/api/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type ModelStats = {
  meshes: number;
  triangles: number;
  size: [number, number, number];
  /** Textures the materials use, once loaded. */
  textures: number;
  /** File names of the textures that could not be loaded (the materials show without them). */
  missingTextures: string[];
  /** The GLB's animations (clips), playable with the handle. */
  animations: { name: string; duration: number }[];
};

/**
 * How the model is drawn: `lit` its own materials (textures and lights), `unlit` its textures without lighting,
 * `clay` plain grey shaded by the lights (shape only), `normals` surface directions as colours, `wireframe` the
 * triangle edges.
 */
export type RenderMode = 'lit' | 'unlit' | 'clay' | 'normals' | 'wireframe';

export type SceneHandle = {
  dispose: () => void;
  setMode: (mode: RenderMode) => void;
  frame: () => void;
  /** Plays animation `index` from the start (the others stop); `null` stops all and restores the rest pose. */
  play: (index: number | null) => void;
  setPaused: (paused: boolean) => void;
  setSpeed: (speed: number) => void;
  /** Seconds into the playing animation. */
  time: () => number;
  seek: (seconds: number) => void;
  /**
   * Loads the animations of another GLB (a clip exported on its own, skeleton only) and makes them this model's:
   * their tracks drive the joints of the same name. Resolves to the new animation list.
   */
  loadAnimations: (glbPath: string) => Promise<{ name: string; duration: number }[]>;
  /** The materials on screen, read from the model itself (for exports that carry no material description). */
  materials: () => SceneMaterial[];
};

/** One material of the model on screen, and the textures it uses. */
export type SceneMaterial = {
  name: string;
  /** Meshes that use it. */
  meshes: number;
  textures: { slot: string; width: number; height: number; thumbnail: string | null }[];
};

/** Texture slots of three.js materials, with the names the panel shows. */
const SLOTS: [keyof THREE.MeshStandardMaterial, string][] = [
  ['map', 'base colour'],
  ['normalMap', 'normal'],
  ['roughnessMap', 'roughness'],
  ['metalnessMap', 'metalness'],
  ['aoMap', 'occlusion'],
  ['emissiveMap', 'emissive'],
  ['alphaMap', 'alpha'],
];

/** A small PNG of `texture`, or null when its image cannot be drawn. */
function thumbnailOf(texture: THREE.Texture): string | null {
  const image: unknown = texture.image;
  if (!(image instanceof ImageBitmap || image instanceof HTMLImageElement || image instanceof HTMLCanvasElement)) {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(image, 0, 0, 64, 64);
  return canvas.toDataURL('image/png');
}

function sceneMaterials(meshes: Map<THREE.Mesh, THREE.Material | THREE.Material[]>): SceneMaterial[] {
  const found = new Map<THREE.Material, SceneMaterial>();
  for (const own of meshes.values()) {
    for (const material of Array.isArray(own) ? own : [own]) {
      const known = found.get(material);
      if (known) {
        known.meshes += 1;
        continue;
      }
      const textures: SceneMaterial['textures'] = [];
      for (const [key, slot] of SLOTS) {
        const value: unknown = Reflect.get(material, key);
        if (!(value instanceof THREE.Texture)) continue;
        const image: unknown = value.image;
        const width = image instanceof ImageBitmap || image instanceof HTMLImageElement ? image.width : 0;
        const height = image instanceof ImageBitmap || image instanceof HTMLImageElement ? image.height : 0;
        textures.push({ slot, width, height, thumbnail: thumbnailOf(value) });
      }
      found.set(material, { name: material.name || `material ${found.size + 1}`, meshes: 1, textures });
    }
  }
  return [...found.values()];
}

/** Bounds of `object`: its meshes, or, for a skeleton without meshes, its joints. */
function boundsOf(object: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3().setFromObject(object);
  if (!box.isEmpty()) return box;
  object.updateMatrixWorld(true);
  object.traverse((node) => {
    if (node !== object) box.expandByPoint(node.getWorldPosition(new THREE.Vector3()));
  });
  return box.isEmpty() ? new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5)) : box;
}

/**
 * Lines from each joint to its parent, for a skeleton without meshes (a clip exported on its own): the bones the
 * animation moves. `update` follows the joints each frame.
 */
function jointLines(root: THREE.Object3D): { lines: THREE.LineSegments; update: () => void } {
  const pairs: [THREE.Object3D, THREE.Object3D][] = [];
  root.traverse((node) => {
    if (node !== root && node.parent && node.parent !== root) pairs.push([node.parent, node]);
  });
  const positions = new Float32Array(pairs.length * 6);
  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3);
  geometry.setAttribute('position', attribute);
  const material = new THREE.LineBasicMaterial({ color: 0x38d6ff, depthTest: false, transparent: true });
  const lines = new THREE.LineSegments(geometry, material);
  lines.renderOrder = 1;
  const point = new THREE.Vector3();
  function update() {
    root.updateMatrixWorld(true);
    pairs.forEach(([parent, child], index) => {
      parent.getWorldPosition(point).toArray(positions, index * 6);
      child.getWorldPosition(point).toArray(positions, index * 6 + 3);
    });
    attribute.needsUpdate = true;
    geometry.computeBoundingSphere();
  }
  update();
  return { lines, update };
}

/** Materials the other modes swap in, made once per scene. */
function modeMaterials() {
  return {
    clay: new THREE.MeshStandardMaterial({ color: 0xb4b4b4, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }),
    normals: new THREE.MeshNormalMaterial({ side: THREE.DoubleSide }),
    wireframe: new THREE.MeshBasicMaterial({ color: 0x9c9c9c, wireframe: true }),
  };
}

/** The material's textures and colour without lighting; other material kinds fall back to white. */
function unlitOf(material: THREE.Material): THREE.MeshBasicMaterial {
  const textured = material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial;
  return new THREE.MeshBasicMaterial({
    map: textured ? material.map : null,
    color: textured ? material.color : 0xffffff,
    vertexColors: material.vertexColors,
    transparent: material.transparent,
    opacity: material.opacity,
    alphaTest: material.alphaTest,
    side: material.side,
  });
}

/** Prefix GLTFLoader puts before the relative URIs of a GLB's resources; {@link loadingManager} replaces it. */
const RESOURCE = 'openvi-resource:';

/**
 * A loading manager that serves the GLB's relative resources (its PNG textures) from beside it on disk, and records
 * the ones that fail. Needed because `convertFileSrc` percent-encodes the whole path into one URL segment, so
 * resolving `textures/a.png` against the GLB's URL would land at the server root, and every texture would fail.
 */
function loadingManager(glbPath: string, failed: string[]): THREE.LoadingManager {
  // A path can mix separators (`…\models/data/…/model.glb` on Windows): split on both, join with the platform's.
  const separator = glbPath.includes('\\') ? '\\' : '/';
  const folder = glbPath.split(/[\\/]/).slice(0, -1);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (!url.startsWith(RESOURCE)) return url;
    // Resolve `.` and `..` here: a texture shared between exports can sit in a sibling folder, and the asset
    // protocol's scope check wants a plain path.
    const parts = [...folder];
    for (const part of decodeURIComponent(url.slice(RESOURCE.length)).split('/')) {
      if (part === '..') parts.pop();
      else if (part !== '.' && part !== '') parts.push(part);
    }
    return convertFileSrc(parts.join(separator));
  });
  manager.onError = (url) => failed.push(decodeURIComponent(url.split(/%5C|%2F|\//i).at(-1) ?? url));
  return manager;
}

/** A model loaded: its scene and animations, how many of its textures loaded and the files of those that did not. */
export type LoadedModel = {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
  textures: number;
  missing: string[];
};

/** Entry `index` of the glTF JSON array `key` (`textures`, `images`…), as an object. */
function entryOf(json: unknown, key: string, index: unknown): object | null {
  if (typeof json !== 'object' || json === null || typeof index !== 'number') return null;
  const list: unknown = Reflect.get(json, key);
  const entry: unknown = Array.isArray(list) ? list[index] : null;
  return typeof entry === 'object' && entry !== null ? entry : null;
}

export async function loadGlb(path: string, failed: string[]): Promise<LoadedModel> {
  const loader = new GLTFLoader(loadingManager(path, failed));
  loader.setResourcePath(RESOURCE);
  const gltf = await loader.loadAsync(convertFileSrc(path));
  // Each texture of the GLB as the loader resolved it (already loaded: no new request); null when it failed.
  const resolved: unknown[] = await gltf.parser.getDependencies('texture');
  const json: unknown = gltf.parser.json;
  const missing: string[] = [];
  resolved.forEach((texture, index) => {
    if (texture) return;
    const source: unknown = Reflect.get(entryOf(json, 'textures', index) ?? {}, 'source');
    const image = entryOf(json, 'images', source);
    const uri: unknown = image ? Reflect.get(image, 'uri') : null;
    missing.push(typeof uri === 'string' ? (decodeURIComponent(uri).split('/').at(-1) ?? uri) : `texture ${index + 1}`);
  });
  return {
    scene: gltf.scene,
    animations: gltf.animations,
    textures: resolved.filter(Boolean).length,
    missing,
  };
}

/** One model of an assembly: a GLB and the column-major matrix that places it. */
type AssemblyPart = { name: string; glb: string; matrix: number[] };

function isAssemblyPart(value: unknown): value is AssemblyPart {
  if (typeof value !== 'object' || value === null) return false;
  const name: unknown = Reflect.get(value, 'name');
  const glb: unknown = Reflect.get(value, 'glb');
  const matrix: unknown = Reflect.get(value, 'matrix');
  return (
    typeof name === 'string' &&
    typeof glb === 'string' &&
    Array.isArray(matrix) &&
    matrix.length === 16 &&
    matrix.every((item) => typeof item === 'number')
  );
}

/**
 * Whether `path` is an assembly manifest (`*.weapon.json`: several GLBs, each with its matrix, written by the
 * backend) rather than one GLB.
 */
export function isAssembly(path: string): boolean {
  return path.toLowerCase().endsWith('.json');
}

/** The GLB at `path`, or every model of the assembly manifest at `path` placed in one group. */
async function loadModel(path: string, failed: string[]): Promise<LoadedModel> {
  if (!isAssembly(path)) return loadGlb(path, failed);
  const response = await fetch(convertFileSrc(path));
  const manifest: unknown = await response.json();
  const models: unknown = typeof manifest === 'object' && manifest !== null ? Reflect.get(manifest, 'models') : null;
  if (!Array.isArray(models) || !models.every(isAssemblyPart)) throw new Error(`${path} is not an assembly`);
  const group = new THREE.Group();
  // A model placed many times (a map area's trees, lamps…) is loaded once; each placement is a clone sharing its
  // geometry and materials.
  const unique = [...new Set(models.map((part) => part.glb))];
  const loaded = new Map(await Promise.all(unique.map(async (glb) => [glb, await loadGlb(glb, failed)] as const)));
  for (const part of models) {
    const source = loaded.get(part.glb);
    if (!source) continue;
    const placed = source.scene.clone();
    placed.name = part.name;
    placed.applyMatrix4(new THREE.Matrix4().fromArray(part.matrix));
    group.add(placed);
  }
  const sources = [...loaded.values()];
  return {
    scene: group,
    animations: [],
    textures: sources.reduce((sum, source) => sum + source.textures, 0),
    missing: sources.flatMap((source) => source.missing),
  };
}

/**
 * Renders the GLB file at `glbPath` in `host`, orbit controls on, model standing on a grid at the origin (glTF is
 * Y-up, in metres). Calls `onReady` once loaded, `onError` when it cannot be. Returns how to drive and dispose it.
 */
export function mountScene(
  host: HTMLElement,
  glbPath: string,
  onReady: (stats: ModelStats) => void,
  onError: (error: unknown) => void,
  options: { autoRotate?: boolean } = {},
): SceneHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#121212');
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2d2d2d, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(5, 10, 7);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  // Previews turn slowly until the user takes the camera.
  controls.autoRotate = options.autoRotate === true;
  controls.autoRotateSpeed = 1.5;
  controls.addEventListener('start', () => {
    controls.autoRotate = false;
  });

  let model: THREE.Object3D | null = null;
  let grid: THREE.GridHelper | null = null;
  let frameId = 0;
  const clock = new THREE.Clock();
  let mixer: THREE.AnimationMixer | null = null;
  let clips: THREE.AnimationClip[] = [];
  let action: THREE.AnimationAction | null = null;
  let paused = false;
  let speed = 1;
  let disposed = false;
  /** Each mesh's own material(s), restored by the `lit` mode. */
  const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const replacements = modeMaterials();
  const unlit = new Map<THREE.Material, THREE.MeshBasicMaterial>();
  let mode: RenderMode = 'lit';
  /** The bones drawn for a model without meshes. */
  let joints: { lines: THREE.LineSegments; update: () => void } | null = null;

  function apply() {
    for (const [mesh, own] of originals) {
      if (mode === 'lit') {
        mesh.material = own;
      } else if (mode === 'unlit') {
        const swap = (material: THREE.Material) => {
          let flat = unlit.get(material);
          if (!flat) {
            flat = unlitOf(material);
            unlit.set(material, flat);
          }
          return flat;
        };
        mesh.material = Array.isArray(own) ? own.map(swap) : swap(own);
      } else {
        mesh.material = replacements[mode];
      }
    }
  }

  function frame() {
    if (!model) return;
    const size = boundsOf(model).getSize(new THREE.Vector3());
    const largest = Math.max(size.x, size.y, size.z, 0.1);
    camera.near = largest / 200;
    camera.far = largest * 200;
    camera.position.set(largest * 1.1, largest * 0.7, largest * 1.5);
    camera.updateProjectionMatrix();
    controls.target.set(0, size.y / 2, 0);
    controls.update();
  }

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

  const failed: string[] = [];
  loadModel(glbPath, failed).then(
    (gltf) => {
      if (disposed) return;
      model = gltf.scene;
      // Centre on the origin, standing on the ground.
      const box = boundsOf(model);
      const centre = box.getCenter(new THREE.Vector3());
      model.position.set(-centre.x, -box.min.y, -centre.z);
      scene.add(model);
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const own: unknown = object.material;
        if (own instanceof THREE.Material) originals.set(object, own);
        else if (Array.isArray(own) && own.every((item): item is THREE.Material => item instanceof THREE.Material)) {
          originals.set(object, own);
        }
      });
      apply();

      const size = box.getSize(new THREE.Vector3());
      const span = Math.ceil(Math.max(size.x, size.z, 1) * 2);
      grid = new THREE.GridHelper(span, Math.min(span * 2, 200), 0x383838, 0x252525);
      scene.add(grid);
      frame();

      let meshes = 0;
      let triangles = 0;
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        meshes += 1;
        const geometry: unknown = object.geometry;
        if (!(geometry instanceof THREE.BufferGeometry)) return;
        triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
      });
      if (meshes === 0) {
        joints = jointLines(model);
        scene.add(joints.lines);
      }
      // Ready before onReady, so the caller can start an animation from it.
      if (gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        clips = gltf.animations;
      }
      onReady({
        meshes,
        triangles: Math.round(triangles),
        size: [size.x, size.y, size.z],
        textures: gltf.textures,
        missingTextures: [...new Set(gltf.missing)],
        animations: clips.map((clip, index) => ({
          name: clip.name || `animation ${index + 1}`,
          duration: clip.duration,
        })),
      });
    },
    (error: unknown) => !disposed && onError(error),
  );

  function render() {
    frameId = requestAnimationFrame(render);
    const delta = clock.getDelta();
    if (mixer && !paused) mixer.update(delta * speed);
    joints?.update();
    controls.update();
    renderer.render(scene, camera);
  }
  render();

  return {
    frame,
    setMode(next) {
      mode = next;
      apply();
    },
    play(index) {
      if (!mixer) return;
      mixer.stopAllAction();
      action = null;
      const clip = index === null ? undefined : clips[index];
      if (!clip) return;
      action = mixer.clipAction(clip);
      action.reset().play();
    },
    setPaused(next) {
      paused = next;
    },
    setSpeed(next) {
      speed = next;
    },
    time() {
      return action ? action.time : 0;
    },
    seek(seconds) {
      if (!action || !mixer) return;
      action.time = seconds;
      mixer.update(0);
    },
    async loadAnimations(path) {
      const gltf = await new GLTFLoader().loadAsync(convertFileSrc(path));
      if (disposed || !model) return [];
      mixer ??= new THREE.AnimationMixer(model);
      mixer.stopAllAction();
      for (const clip of clips) mixer.uncacheClip(clip);
      action = null;
      clips = gltf.animations;
      return clips.map((clip, index) => ({ name: clip.name || `animation ${index + 1}`, duration: clip.duration }));
    },
    materials() {
      return sceneMaterials(originals);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameId);
      mixer?.stopAllAction();
      observer.disconnect();
      joints?.lines.geometry.dispose();
      if (joints && joints.lines.material instanceof THREE.Material) joints.lines.material.dispose();
      controls.dispose();
      for (const [mesh, own] of originals) {
        const geometry: unknown = mesh.geometry;
        if (geometry instanceof THREE.BufferGeometry) geometry.dispose();
        for (const material of Array.isArray(own) ? own : [own]) {
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) value.dispose();
          }
          material.dispose();
        }
      }
      // The unlit copies share the originals' textures, disposed above.
      for (const material of [...unlit.values(), ...Object.values(replacements)]) material.dispose();
      grid?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
