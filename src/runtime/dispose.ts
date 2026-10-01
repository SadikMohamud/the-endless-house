import type * as THREE from 'three/webgpu';

/** Disposes every geometry, material and texture under `root`. Shared resources are disposed once. */
export function disposeObject3D(root: THREE.Object3D): void {
  const seen = new Set<{ dispose(): void }>();
  const add = (r: { dispose(): void } | null | undefined) => r && seen.add(r);

  root.traverse((obj) => {
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
