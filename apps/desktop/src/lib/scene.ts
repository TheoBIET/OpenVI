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
};

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
  const cut = Math.max(glbPath.lastIndexOf('\\'), glbPath.lastIndexOf('/'));
  const folder = glbPath.slice(0, cut);
  const separator = glbPath[cut] ?? '/';
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (!url.startsWith(RESOURCE)) return url;
    // Resolve `.` and `..` here: a texture shared between exports can sit in a sibling folder, and the asset
    // protocol's scope check wants a plain path.
    const parts = folder.split(separator);
    for (const part of decodeURIComponent(url.slice(RESOURCE.length)).split('/')) {
      if (part === '..') parts.pop();
      else if (part !== '.' && part !== '') parts.push(part);
    }
    return convertFileSrc(parts.join(separator));
  });
  manager.onError = (url) => failed.push(decodeURIComponent(url.split(/%5C|%2F|\//i).at(-1) ?? url));
  return manager;
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
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
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
  const loader = new GLTFLoader(loadingManager(glbPath, failed));
  loader.setResourcePath(RESOURCE);
  loader.load(
    convertFileSrc(glbPath),
    (gltf) => {
      if (disposed) return;
      model = gltf.scene;
      // Centre on the origin, standing on the ground.
      const box = new THREE.Box3().setFromObject(model);
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
      const textures = new Set<THREE.Texture>();
      for (const own of originals.values()) {
        for (const material of Array.isArray(own) ? own : [own]) {
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        }
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
        textures: textures.size,
        missingTextures: [...new Set(failed)],
        animations: clips.map((clip, index) => ({
          name: clip.name || `animation ${index + 1}`,
          duration: clip.duration,
        })),
      });
    },
    undefined,
    (error) => !disposed && onError(error),
  );

  function render() {
    frameId = requestAnimationFrame(render);
    const delta = clock.getDelta();
    if (mixer && !paused) mixer.update(delta * speed);
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
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameId);
      mixer?.stopAllAction();
      observer.disconnect();
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
