import type RAPIER from '@dimforge/rapier3d-compat';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MOVEMENT_PROFILES,
  PHYSICS_PROFILES,
  PhysicsProfile,
  type PhysicsProfile as PhysicsProfileT,
} from '../src/domain';
import { loadPhysics } from '../src/platform/physics';
import { NO_INTENT, Player, type MoveIntent } from '../src/runtime/player';

const DT = 1 / 60;
const JUMP = MOVEMENT_PROFILES.STANDARD.jumpSpeed!;
let world: RAPIER.World | null = null;

afterEach(() => {
  world?.free();
  world = null;
});

/** A flat floor, a visitor with STANDARD movement, and the given physics profile. */
async function arena(physics: PhysicsProfileT, startY = 0, settleSteps = 20) {
  const rapier = await loadPhysics();
  world?.free();
  world = new rapier.World(physics.gravity);
  world.createCollider(rapier.ColliderDesc.cuboid(200, 0.1, 200).setTranslation(0, -0.1, 0));
  const player = new Player(rapier, world, {
    position: { x: 0, y: startY, z: 0 },
    yaw: 0,
    movement: MOVEMENT_PROFILES.STANDARD,
    physics,
  });
  const w = world;
  w.step();
  const step = (intent: MoveIntent) => {
    player.fixedStep(intent, DT);
    w.step();
  };
  for (let i = 0; i < settleSteps; i++) step(NO_INTENT);
  return { player, step };
}

/** Jumps once from rest and measures the result. */
async function measureJump(physics: PhysicsProfileT, run = false) {
  const { player, step } = await arena(physics);
  const move = run ? { ...NO_INTENT, forward: 1, sprint: true } : NO_INTENT;
  if (run) for (let i = 0; i < 90; i++) step(move); // reach sprint speed
  const start = player.feet;
  step({ ...move, jump: true });
  let apex = 0;
  let steps = 1;
  while (steps < 60 * 20) {
    step(move);
    steps++;
    apex = Math.max(apex, player.feet.y - start.y);
    if (player.grounded && player.velocity.y === 0 && steps > 3) break;
  }
  const end = player.feet;
  return { apex, airtime: steps * DT, distance: Math.hypot(end.x - start.x, end.z - start.z) };
}

describe('AT-09: physics profiles change measured behaviour', () => {
  it('EARTH jump matches v²/2g and 2v/g', async () => {
    const g = -PHYSICS_PROFILES.EARTH.gravity.y;
    const { apex, airtime } = await measureJump(PHYSICS_PROFILES.EARTH);
    console.log(`EARTH: apex ${apex.toFixed(3)} m, airtime ${airtime.toFixed(3)} s`);
    expect(apex).toBeGreaterThan(((JUMP * JUMP) / (2 * g)) * 0.9);
    expect(apex).toBeLessThan(((JUMP * JUMP) / (2 * g)) * 1.1);
    expect(airtime).toBeGreaterThan(((2 * JUMP) / g) * 0.9);
    expect(airtime).toBeLessThan(((2 * JUMP) / g) * 1.1);
  });

  it('LOW_GRAVITY jump is higher and longer, matching its gravity', async () => {
    const g = -PHYSICS_PROFILES.LOW_GRAVITY.gravity.y;
    const { apex, airtime } = await measureJump(PHYSICS_PROFILES.LOW_GRAVITY);
    console.log(`LOW_GRAVITY: apex ${apex.toFixed(3)} m, airtime ${airtime.toFixed(3)} s`);
    // Air damping takes a little off the ideal; allow 10% below.
    expect(apex).toBeGreaterThan(((JUMP * JUMP) / (2 * g)) * 0.9);
    expect(apex).toBeLessThan(((JUMP * JUMP) / (2 * g)) * 1.02);
    expect(airtime).toBeGreaterThan(((2 * JUMP) / g) * 0.9);
    expect(airtime).toBeLessThan(((2 * JUMP) / g) * 1.05);
  });

  it('the same jump differs by the gravity ratio between profiles', async () => {
    const earth = await measureJump(PHYSICS_PROFILES.EARTH);
    const low = await measureJump(PHYSICS_PROFILES.LOW_GRAVITY);
    const ratio = PHYSICS_PROFILES.EARTH.gravity.y / PHYSICS_PROFILES.LOW_GRAVITY.gravity.y; // ≈3.9
    expect(low.apex / earth.apex).toBeGreaterThan(ratio * 0.85);
    expect(low.airtime / earth.airtime).toBeGreaterThan(ratio * 0.85);
  });

  it('a running jump carries further under low gravity (momentum)', async () => {
    const earth = await measureJump(PHYSICS_PROFILES.EARTH, true);
    const low = await measureJump(PHYSICS_PROFILES.LOW_GRAVITY, true);
    console.log(
      `running jump: EARTH ${earth.distance.toFixed(2)} m, LOW ${low.distance.toFixed(2)} m`,
    );
    expect(low.distance).toBeGreaterThan(earth.distance * 3);
  });

  it('timeScale slows the simulation: a 0.5 profile falls in twice the time', async () => {
    // Steps (of wall-clock 1/60 s) to fall 5 m onto the floor.
    const fallTime = async (physics: PhysicsProfileT) => {
      const { player, step } = await arena(physics, 5, 0);
      let steps = 0;
      while (!player.grounded && steps < 2000) {
        step(NO_INTENT);
        steps++;
      }
      return steps;
    };
    const normal = await fallTime(PHYSICS_PROFILES.EARTH);
    const slow = await fallTime(
      PhysicsProfile.parse({ ...PHYSICS_PROFILES.EARTH, timeScale: 0.5 }),
    );
    expect(slow / normal).toBeGreaterThan(1.8);
    expect(slow / normal).toBeLessThan(2.2);
  });

  it('rejects gravity the runtime cannot honour', () => {
    const sideways = { ...PHYSICS_PROFILES.EARTH, gravity: { x: 3, y: -9.81, z: 0 } };
    expect(PhysicsProfile.safeParse(sideways).success).toBe(false);
    const upwards = { ...PHYSICS_PROFILES.EARTH, gravity: { x: 0, y: 2, z: 0 } };
    expect(PhysicsProfile.safeParse(upwards).success).toBe(false);
  });
});
