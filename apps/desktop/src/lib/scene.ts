// three.js scene for the model view, loaded on first use: import this module with `import()`.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type ModelStats = { meshes: number; triangles: number; size: [number, number, number] };

export type SceneHandle = { dispose: () => void; setWireframe: (on: boolean) => void; frame: () => void };

/** Materials of a mesh, whether it has one or several. */
function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/**
 * Renders the GLB at `url` in `host`, orbit controls on, model standing on a grid at the origin (glTF is Y-up,
 * in metres). Calls `onReady` once loaded, `onError` when it cannot be. Returns how to drive and dispose it.
 */
export function mountScene(
  host: HTMLElement,
  url: string,
  onReady: (stats: ModelStats) => void,
  onError: (error: unknown) => void,
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

  let model: THREE.Object3D | null = null;
  let grid: THREE.GridHelper | null = null;
  let frameId = 0;
  let disposed = false;

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

  new GLTFLoader().load(
    url,
    (gltf) => {
      if (disposed) return;
      model = gltf.scene;
      // Centre on the origin, standing on the ground.
      const box = new THREE.Box3().setFromObject(model);
      const centre = box.getCenter(new THREE.Vector3());
      model.position.set(-centre.x, -box.min.y, -centre.z);
      scene.add(model);

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
      onReady({ meshes, triangles: Math.round(triangles), size: [size.x, size.y, size.z] });
    },
    undefined,
    (error) => !disposed && onError(error),
  );

  function render() {
    frameId = requestAnimationFrame(render);
    controls.update();
    renderer.render(scene, camera);
  }
  render();

  return {
    frame,
    setWireframe(on) {
      model?.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of materialsOf(object)) {
          if ('wireframe' in material) Reflect.set(material, 'wireframe', on);
        }
      });
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameId);
      observer.disconnect();
      controls.dispose();
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const geometry: unknown = object.geometry;
        if (geometry instanceof THREE.BufferGeometry) geometry.dispose();
        for (const material of materialsOf(object)) {
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) value.dispose();
          }
          material.dispose();
        }
      });
      grid?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
