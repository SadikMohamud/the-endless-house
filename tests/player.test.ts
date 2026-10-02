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
  /** Distance covered in 1 s once up to speed (after a 1 s ramp). */
  const steadyDistance = (intent: MoveIntent) => {
    run(intent, 60);
    const a = player.feet;
    run(intent, 60);
    const b = player.feet;
    return { dx: b.x - a.x, dz: b.z - a.z, d: Math.hypot(b.x - a.x, b.z - a.z) };
  };
  return { player, run, steadyDistance };
}

const forward: MoveIntent = { ...NO_INTENT, forward: 1 };

/**
 * Steady-state distance per second. Velocity holds the profile speed exactly, but Rapier's
 * controller occasionally shortens a single step on flat ground, so distance can fall up to
 * a few percent short. Never over.
 */
const expectSpeed = (metresPerSecond: number, expected: number) => {
  expect(metresPerSecond).toBeGreaterThan(expected * 0.95);
  expect(metresPerSecond).toBeLessThan(expected * 1.01);
};

describe('Player movement', () => {
  it('walks at the profile walk speed (1.5 m/s) once up to speed', async () => {
    const { steadyDistance } = await setup();
    const { dz, d } = steadyDistance(forward);
    // Forward at yaw 0 is -Z.
    expect(dz).toBeLessThan(0);
    expectSpeed(d, 1.5);
  });

  it('accelerates gently rather than snapping to speed', async () => {
    const { player, run } = await setup();
    run(forward, 6); // 0.1 s
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    // WALK accelerates at 6 m/s²: about 0.6 m/s after 0.1 s.
    expect(speed).toBeGreaterThan(0.45);
    expect(speed).toBeLessThan(0.75);
  });

  it('comes to rest when input stops, faster with more friction', async () => {
    const stoppingDistance = async (friction: number) => {
      const { player, run } = await setup();
      player.physics = { ...PHYSICS_PROFILES.EARTH, friction };
      run(forward, 120);
      const z0 = player.feet.z;
      run(NO_INTENT, 120);
      expect(Math.hypot(player.velocity.x, player.velocity.z)).toBeLessThan(1e-6);
      const distance = z0 - player.feet.z;
      world?.free();
      world = null;
      return distance;
    };
    const grippy = await stoppingDistance(1.0);
    const slippery = await stoppingDistance(0.25);
    // v²/(2a): 1.5²/(2·8) ≈ 0.14 m at friction 1; four times further at 0.25.
    expect(grippy).toBeCloseTo(0.14, 1);
    expect(slippery / grippy).toBeGreaterThan(3);
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

  it('spawning exactly on a surface does not sink into it (regression)', async () => {
    // Before the spawn clearance, a capsule starting in contact fell through a large floor.
    const rapier = await loadPhysics();
    world = new rapier.World(PHYSICS_PROFILES.EARTH.gravity);
    world.createCollider(rapier.ColliderDesc.cuboid(200, 0.1, 200).setTranslation(0, -0.1, 0));
    const player = new Player(rapier, world, {
      position: { x: 0, y: 0, z: 0 },
      yaw: 0,
      movement: MOVEMENT_PROFILES.STANDARD,
      physics: PHYSICS_PROFILES.EARTH,
    });
    world.step();
    for (let i = 0; i < 120; i++) {
      player.fixedStep(NO_INTENT, DT);
      world.step();
    }
    expect(player.grounded).toBe(true);
    expect(player.feet.y).toBeGreaterThanOrEqual(0);
    expect(player.feet.y).toBeLessThan(0.02);
  });

  it('falls under gravity and lands on the floor', async () => {
    const { player, run } = await setup({ startY: 2 });
    run(NO_INTENT, 120);
    expect(player.grounded).toBe(true);
    expect(player.feet.y).toBeGreaterThan(-0.05);
    expect(player.feet.y).toBeLessThan(0.1);
  });

  it('WALK ignores jump and sprint (House rules)', async () => {
    const { player, run, steadyDistance } = await setup({ movement: MOVEMENT_PROFILES.WALK });
    run({ ...NO_INTENT, jump: true }, 1);
    run(NO_INTENT, 10);
    expect(player.feet.y).toBeLessThan(0.1);
    expectSpeed(steadyDistance({ ...forward, sprint: true }).d, 1.5);
  });

  it('STANDARD allows jump and sprint (world rules)', async () => {
    const { player, run, steadyDistance } = await setup({
      movement: MOVEMENT_PROFILES.STANDARD,
    });
    run({ ...NO_INTENT, jump: true }, 1);
    run(NO_INTENT, 15);
    expect(player.feet.y).toBeGreaterThan(0.3);

    run(NO_INTENT, 120); // land
    expectSpeed(steadyDistance({ ...forward, sprint: true }).d, 3.0);
  });

  it('mouse look turns the walking direction', async () => {
    const { player, steadyDistance } = await setup();
    player.look(Math.PI / 2, 0); // turn right 90 degrees: forward becomes +X
    const { dx, dz } = steadyDistance(forward);
    expectSpeed(dx, 1.5);
    expect(Math.abs(dz)).toBeLessThan(0.01);
  });

  it('clamps vertical look', async () => {
    const { player } = await setup();
    player.look(0, -10);
    expect(player.pitch).toBeLessThanOrEqual((85 * Math.PI) / 180 + 1e-9);
  });
});
