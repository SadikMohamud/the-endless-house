import type RAPIER from '@dimforge/rapier3d-compat';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_HOUSE_DNA, type MovementProfile } from '../src/domain';
import { DEFAULT_BUDGET, generateForest, heightAt } from '../src/gen/forest';
import { planWorld } from '../src/gen/planner';
import { seedsFromWorldSeed } from '../src/gen/seeds';
import { loadPhysics } from '../src/platform/physics';
import { NO_INTENT, Player, type MoveIntent } from '../src/runtime/player';
import { buildForestColliders } from '../src/world/forest-physics';

const DT = 1 / 60;
const reality = planWorld(seedsFromWorldSeed('physics-check'));
const forest = generateForest({
  worldId: 'w',
  journeyId: 'j',
  reality,
  frame: { width: DEFAULT_HOUSE_DNA.doorWidth, height: DEFAULT_HOUSE_DNA.doorHeight },
  budget: DEFAULT_BUDGET,
});

let world: RAPIER.World | null = null;
afterEach(() => {
  world?.free();
  world = null;
});

async function visitorAt(x: number, z: number, yaw = 0, movement?: MovementProfile) {
  const rapier = await loadPhysics();
  world = new rapier.World(reality.physicsProfile.gravity);
  buildForestColliders(rapier, world, forest);
  const player = new Player(rapier, world, {
    position: { x, y: heightAt(forest.terrain, x, z) + 1, z },
    yaw,
    movement: movement ?? reality.movementProfile,
    physics: reality.physicsProfile,
  });
  const w = world;
  w.step();
  const run = (intent: MoveIntent, seconds: number) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      player.fixedStep(intent, DT);
      w.step();
    }
  };
  return { player, run };
}

describe('forest colliders', () => {
  it('ground collider matches the generated terrain (not transposed)', async () => {
    // Points clear of trees where a transposed heightfield would be at least 0.5 m off.
    const points: Array<{ x: number; z: number }> = [];
    for (let x = -70; x <= 70 && points.length < 4; x += 7) {
      for (let z = -70; z <= 70 && points.length < 4; z += 7) {
        const asymmetry = Math.abs(heightAt(forest.terrain, x, z) - heightAt(forest.terrain, z, x));
        const clear = forest.trees.every((t) => Math.hypot(t.x - x, t.z - z) > 2.5);
        if (asymmetry > 0.5 && clear) points.push({ x, z });
      }
    }
    expect(points.length).toBe(4);
    for (const p of points) {
      const { player, run } = await visitorAt(p.x, p.z);
      run(NO_INTENT, 3);
      expect(player.grounded).toBe(true);
      expect(
        Math.abs(player.feet.y - heightAt(forest.terrain, player.feet.x, player.feet.z)),
      ).toBeLessThan(0.15);
      world?.free();
      world = null;
    }
  });

  it('tree trunks are solid', async () => {
    // Walk towards the nearest tree from 4 m away.
    const t = forest.trees[Math.floor(forest.trees.length / 2)]!;
    const { player, run } = await visitorAt(t.x, t.z + 4, 0);
    run({ ...NO_INTENT, forward: 1 }, 6);
    const d = Math.hypot(player.feet.x - t.x, player.feet.z - t.z);
    // Either stopped at the trunk or slid round it, but never through its centre.
    expect(d).toBeGreaterThan(t.radius + 0.25);
  });

  it('the frame opening can be walked through; arriving visitors face away from it', async () => {
    const s = forest.spawn;
    const yaw = Math.atan2(-s.facing.x, -s.facing.z);
    const { player, run } = await visitorAt(s.x, s.z, yaw);
    run(NO_INTENT, 0.5);
    // Walk backwards through the frame.
    run({ ...NO_INTENT, forward: -1 }, 4);
    const fr = forest.returnFrame;
    const along = (player.feet.x - fr.x) * fr.facing.x + (player.feet.z - fr.z) * fr.facing.z;
    expect(along).toBeLessThan(-1.5);
  });
});
