import type * as THREE from 'three/webgpu';

type Disposable = { dispose(): void };

/**
 * Releases every GPU resource under `root`: geometries, materials, their textures, instance
 * buffers (InstancedMesh.dispose) and light shadow maps (Light.dispose). Shared resources are
 * disposed once.
 */
export function disposeObject3D(root: THREE.Object3D): void {
  const seen = new Set<Disposable>();
  const add = (r: Disposable | null | undefined) => r && seen.add(r);

  root.traverse((obj) => {
    // Lights own shadow render targets; instanced meshes own instance buffers.
    if ((obj as THREE.Light).isLight || (obj as THREE.InstancedMesh).isInstancedMesh) {
      add(obj as unknown as Disposable);
    }
    const mesh = obj as Partial<THREE.Mesh>;
    add(mesh.geometry);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      if (!m) continue;
      add(m);
      for (const value of Object.values(m)) {
        if (value && typeof value === 'object' && (value as THREE.Texture).isTexture)
          add(value as THREE.Texture);
      }
    }
  });
  for (const r of seen) r.dispose();
  root.clear();
}
