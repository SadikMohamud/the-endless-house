import type * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { DEFAULT_HOUSE_DNA } from '../src/domain';
import { seedsFromWorldSeed } from '../src/gen/seeds';
import { buildDestination } from '../src/journey/destination';
import { loadPhysics } from '../src/platform/physics';
import type { Stage } from '../src/runtime/stage';
import { ForestStage } from '../src/stages/forest-stage';
import { HouseStage } from '../src/stages/house-stage';

/** Every disposable GPU resource reachable from the scene, each with a disposed flag. */
function track(scene: THREE.Scene) {
  const tracked = new Map<THREE.EventDispatcher<{ dispose: object }>, { disposed: boolean }>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const owners =
      (o as THREE.Light).isLight || (o as THREE.InstancedMesh).isInstancedMesh ? [o] : [];
    const list = [
      ...owners,
      mesh.geometry,
      ...(Array.isArray(mesh.material) ? mesh.material : [mesh.material]),
    ] as Array<THREE.EventDispatcher<{ dispose: object }> | undefined>;
    for (const r of list) {
      if (!r || tracked.has(r)) continue;
      const flag = { disposed: false };
      tracked.set(r, flag);
      r.addEventListener('dispose', () => (flag.disposed = true));
    }
  });
  return tracked;
}

async function checkStageCleanup(make: () => Stage) {
  const stage = make();
  const resources = track(stage.scene);
  expect(resources.size).toBeGreaterThan(5);
  stage.dispose();
  const leaked = [...resources.values()].filter((r) => !r.disposed).length;
  expect(leaked).toBe(0);
  expect(stage.scene.children).toHaveLength(0);
  return resources.size;
}

describe('AT-11: resource cleanup', () => {
  it('the House stage releases all its geometry, materials and physics', async () => {
    const rapier = await loadPhysics();
    let house: HouseStage | null = null;
    const n = await checkStageCleanup(
      () => (house = new HouseStage(rapier, DEFAULT_HOUSE_DNA, 'h')),
    );
    // The physics world is freed: touching the visitor's body afterwards fails.
    expect(() => house!.player.feet).toThrow();
    console.log(`House: ${n} GPU resources created and released`);
  });

  it('the forest stage releases all its geometry, materials and physics', async () => {
    const rapier = await loadPhysics();
    const d = buildDestination(
      seedsFromWorldSeed('cleanup'),
      { worldId: 'w', journeyId: 'j' },
      DEFAULT_HOUSE_DNA,
    );
    let forest: ForestStage | null = null;
    const n = await checkStageCleanup(
      () => (forest = new ForestStage(rapier, d.reality, d.forest, DEFAULT_HOUSE_DNA)),
    );
    expect(() => forest!.player.feet).toThrow();
    console.log(`Forest: ${n} GPU resources created and released`);
  });

  it('repeated House ↔ forest cycles leave nothing behind', async () => {
    const rapier = await loadPhysics();
    let live = 0;
    for (let i = 0; i < 5; i++) {
      const d = buildDestination(
        seedsFromWorldSeed(`cycle-${i}`),
        { worldId: 'w', journeyId: 'j' },
        DEFAULT_HOUSE_DNA,
      );
      for (const stage of [
        new HouseStage(rapier, DEFAULT_HOUSE_DNA, 'h'),
        new ForestStage(rapier, d.reality, d.forest, DEFAULT_HOUSE_DNA),
      ]) {
        const resources = track(stage.scene);
        live += resources.size;
        stage.dispose();
        live -= [...resources.values()].filter((r) => r.disposed).length;
      }
    }
    expect(live).toBe(0);
  });
});
