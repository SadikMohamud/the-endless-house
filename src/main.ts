// Phase 1 foundation check. Proves Three.js and Rapier start in the browser.
// Replaced by the real runtime in Phase 3.
import * as THREE from 'three/webgpu';
import { loadPhysics } from './platform/physics';

declare global {
  interface Window {
    __foundation?: { physics: string; renderer: string; error?: string };
  }
}

const status = document.getElementById('status')!;
const app = document.getElementById('app')!;

async function start(): Promise<void> {
  const rapier = await loadPhysics();

  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  app.appendChild(renderer.domElement);
  await renderer.init();

  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? 'webgpu'
    : 'webgl2';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 1.65, 4);
  scene.add(new THREE.HemisphereLight(0x8fa6c8, 0x3b2a20, 1));
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 2.4, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x2a1e17 }),
  );
  box.position.y = 1.2;
  scene.add(box);
  renderer.render(scene, camera);

  window.__foundation = { physics: `rapier ${rapier.version()}`, renderer: backend };
  status.textContent = `rapier ${rapier.version()} · ${backend}`;
}

start().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  window.__foundation = { physics: 'failed', renderer: 'failed', error: message };
  status.textContent = `error: ${message}`;
  console.error(err);
});
