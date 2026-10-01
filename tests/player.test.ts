import type RAPIER from '@dimforge/rapier3d-compat';
import { afterEach, describe, expect, it } from 'vitest';
import { MOVEMENT_PROFILES, PHYSICS_PROFILES, type MovementProfile } from '../src/domain';
import { loadPhysics } from '../src/platform/physics';
import { NO_INTENT, Player, type MoveIntent } from '../src/runtime/player';

const DT = 1 / 60;
let world: RAPIER.World | null = null;

afterEach(() => {
  world?.free();
  world = null;
});

/** Floor at y=0 and, optionally, a wall whose near face is at z = wallZ. */
async function setup(opts: { movement?: MovementProfile; startY?: number; wallZ?: number } = {}) {
  const rapier = await loadPhysics();
  const physics = PHYSICS_PROFILES.EARTH;
  world = new rapier.World(physics.gravity);
  world.createCollider(rapier.ColliderDesc.cuboid(50, 0.1, 50).setTranslation(0, -0.1, 0));
  if (opts.wallZ !== undefined) {
    world.createCollider(
      rapier.ColliderDesc.cuboid(5, 2, 0.1).setTranslation(0, 2, opts.wallZ - 0.1),
    );
  }
  const player = new Player(rapier, world, {
    position: { x: 0, y: opts.startY ?? 0, z: 0 },
    yaw: 0,
    movement: opts.movement ?? MOVEMENT_PROFILES.WALK,
    physics,
  });
  const w = world;
  w.step();
  const run = (intent: MoveIntent, steps: number) => {
    for (let i = 0; i < steps; i++) {
      player.fixedStep(intent, DT);
      w.step();
    }
  };
  // Settle onto the floor.
  run(NO_INTENT, 10);
  return { player, run };
}

const forward: MoveIntent = { ...NO_INTENT, forward: 1 };

describe('Player movement', () => {
  it('walks at the profile walk speed (1.5 m/s)', async () => {
    const { player, run } = await setup();
    const z0 = player.feet.z;
    run(forward, 60);
    // Forward at yaw 0 is -Z.
    expect(z0 - player.feet.z).toBeCloseTo(1.5, 1);
  });

  it('does not walk through a wall', async () => {
    const { player, run } = await setup({ wallZ: -2 });
    run(forward, 600); // 10 s: would travel 15 m without the wall
    // Stops at the wall face plus the capsule radius, with the controller's small offset.
    expect(player.feet.z).toBeGreaterThan(-2 + 0.29);
    expect(player.feet.z).toBeLessThan(-2 + 0.4);
  });

  it('slides along a wall instead of sticking to it', async () => {
    const { player, run } = await setup({ wallZ: -1 });
    run({ ...NO_INTENT, forward: 1, right: 1 }, 120);
    expect(player.feet.x).toBeGreaterThan(1);
  });

  it('falls under gravity and lands on the floor', async () => {
    const { player, run } = await setup({ startY: 2 });
    run(NO_INTENT, 120);
    expect(player.grounded).toBe(true);
    expect(player.feet.y).toBeGreaterThan(-0.05);
    expect(player.feet.y).toBeLessThan(0.1);
  });

  it('WALK ignores jump and sprint (House rules)', async () => {
    const { player, run } = await setup({ movement: MOVEMENT_PROFILES.WALK });
    run({ ...NO_INTENT, jump: true }, 1);
    run(NO_INTENT, 10);
    expect(player.feet.y).toBeLessThan(0.1);

    const z0 = player.feet.z;
    run({ ...forward, sprint: true }, 60);
    expect(z0 - player.feet.z).toBeCloseTo(1.5, 1);
  });

  it('STANDARD allows jump and sprint (world rules)', async () => {
    const { player, run } = await setup({ movement: MOVEMENT_PROFILES.STANDARD });
    run({ ...NO_INTENT, jump: true }, 1);
    run(NO_INTENT, 15);
    expect(player.feet.y).toBeGreaterThan(0.3);

    run(NO_INTENT, 120); // land
    const z0 = player.feet.z;
    run({ ...forward, sprint: true }, 60);
    expect(z0 - player.feet.z).toBeCloseTo(3.0, 1);
  });

  it('mouse look turns the walking direction', async () => {
    const { player, run } = await setup();
    player.look(Math.PI / 2, 0); // turn right 90 degrees: forward becomes +X
    run(forward, 60);
    expect(player.feet.x).toBeCloseTo(1.5, 1);
    expect(Math.abs(player.feet.z)).toBeLessThan(0.05);
  });

  it('clamps vertical look', async () => {
    const { player } = await setup();
    player.look(0, -10);
    expect(player.pitch).toBeLessThanOrEqual((85 * Math.PI) / 180 + 1e-9);
  });
});
