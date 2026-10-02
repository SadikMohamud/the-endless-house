import type RAPIER from '@dimforge/rapier3d-compat';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_HOUSE_DNA, House, MOVEMENT_PROFILES, PHYSICS_PROFILES } from '../src/domain';
import { DOOR_OPEN_ANGLE, DOOR_SWING_SECONDS, DoorSwing } from '../src/house/door';
import { INTERACTION_RANGE, rayBoxDistance, viewDirection } from '../src/house/interaction';
import { buildHouseLayout } from '../src/house/layout';
import { loadPhysics } from '../src/platform/physics';
import { NO_INTENT, Player, type MoveIntent } from '../src/runtime/player';

const DT = 1 / 60;
const layout = buildHouseLayout(DEFAULT_HOUSE_DNA, 'house-seed-1');
const room = (id: string) => layout.house.rooms.find((r) => r.id === id)!;

let world: RAPIER.World | null = null;
afterEach(() => {
  world?.free();
  world = null;
});

/** The House's colliders in a Rapier world, with a walking visitor at the spawn point. */
async function walkHouse() {
  const rapier = await loadPhysics();
  world = new rapier.World(PHYSICS_PROFILES.EARTH.gravity);
  for (const s of layout.solids.filter((s) => s.collide)) {
    world.createCollider(
      rapier.ColliderDesc.cuboid(s.size.x / 2, s.size.y / 2, s.size.z / 2).setTranslation(
        s.centre.x,
        s.centre.y,
        s.centre.z,
      ),
    );
  }
  const spawn = layout.house.spawn;
  const player = new Player(rapier, world, {
    position: spawn.position,
    yaw: spawn.facing,
    movement: MOVEMENT_PROFILES.WALK,
    physics: PHYSICS_PROFILES.EARTH,
  });
  const w = world;
  w.step();
  const run = (intent: MoveIntent, seconds: number) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      player.fixedStep(intent, DT);
      w.step();
    }
  };
  run(NO_INTENT, 0.2);
  return { player, run };
}

const inside = (p: { x: number; z: number }) =>
  layout.house.rooms.some(
    (r) => p.x >= r.min.x && p.x <= r.max.x && p.z >= r.min.z && p.z <= r.max.z,
  );

describe('House layout', () => {
  it('produces a valid House', () => {
    expect(House.safeParse(layout.house).success).toBe(true);
  });

  it('is built from the DNA', () => {
    const dna = DEFAULT_HOUSE_DNA;
    const corridor = room('corridor');
    expect(corridor.max.z - corridor.min.z).toBeCloseTo(dna.corridorLength);
    expect(corridor.max.x - corridor.min.x).toBeCloseTo(dna.corridorWidth);
    const start = room('start-room');
    expect(start.max.x - start.min.x).toBeCloseTo(dna.firstRoom.width);
    expect(start.max.z - start.min.z).toBeCloseTo(dna.firstRoom.depth);
    expect(start.max.y).toBeCloseTo(dna.ceilingHeight);
    expect(layout.door.width).toBe(dna.doorWidth);
    expect(layout.door.height).toBe(dna.doorHeight);
  });

  it('puts the door on the corridor axis, in the door room, facing the visitor', () => {
    const [door] = layout.house.doors;
    expect(door).toMatchObject({ type: 'PRIVATE_WORLD', state: 'CLOSED', roomId: 'door-room' });
    expect(door!.position.x).toBe(0);
    expect(layout.house.spawn.position.x).toBe(0);
    expect(layout.house.spawn.roomId).toBe('start-room');
  });

  it('is deterministic', () => {
    expect(buildHouseLayout(DEFAULT_HOUSE_DNA, 'house-seed-1')).toEqual(layout);
  });

  it('places panelling below the dado rail height only', () => {
    const panels = layout.solids.filter((s) => s.material === 'panelling');
    expect(panels.length).toBeGreaterThan(0);
    for (const p of panels) {
      expect(p.centre.y + p.size.y / 2).toBeLessThanOrEqual(
        DEFAULT_HOUSE_DNA.panellingHeight + 1e-9,
      );
    }
  });
});

describe('Walking the House (real collision)', () => {
  it('walks from the start room, through the corridor, to the door, and stops at it', async () => {
    const { player, run } = await walkHouse();
    run({ ...NO_INTENT, forward: 1 }, 30);
    const doorFace = layout.door.faceZ;
    expect(player.feet.z).toBeGreaterThan(doorFace + 0.28);
    expect(player.feet.z).toBeLessThan(doorFace + 0.45);
    expect(Math.abs(player.feet.x)).toBeLessThan(0.05);
  });

  it('cannot leave the House in any direction from the start room', async () => {
    for (let k = 0; k < 8; k++) {
      const { player, run } = await walkHouse();
      player.look((k * Math.PI) / 4, 0);
      run({ ...NO_INTENT, forward: 1 }, 15);
      expect(inside(player.feet), `heading ${k * 45}°`).toBe(true);
      world?.free();
      world = null;
    }
  });

  it('cannot climb through the window', async () => {
    const { player, run } = await walkHouse();
    // Face the west wall (window) and walk into it for a long time.
    player.look(-Math.PI / 2, 0);
    run({ ...NO_INTENT, forward: 1, right: 0 }, 12);
    expect(player.feet.x).toBeGreaterThan(room('start-room').min.x);
    expect(player.feet.y).toBeLessThan(0.1);
  });
});

describe('Door interaction', () => {
  const d = layout.door;
  const min = { x: d.hinge.x, y: 0, z: d.faceZ - d.thickness };
  const max = { x: d.hinge.x + d.width, y: d.height, z: d.faceZ };
  const eyeAt = (distance: number) => ({ x: 0, y: 1.65, z: d.faceZ + distance });

  it('is in reach at 1.2 m while looking at it', () => {
    const hit = rayBoxDistance(eyeAt(1.2), viewDirection(0, 0), min, max, INTERACTION_RANGE);
    expect(hit).toBeCloseTo(1.2);
  });

  it('is out of reach at 2 m', () => {
    expect(rayBoxDistance(eyeAt(2), viewDirection(0, 0), min, max, INTERACTION_RANGE)).toBeNull();
  });

  it('is out of reach when looking away or over it', () => {
    expect(
      rayBoxDistance(eyeAt(1), viewDirection(Math.PI, 0), min, max, INTERACTION_RANGE),
    ).toBeNull();
    expect(rayBoxDistance(eyeAt(1), viewDirection(0, 1.2), min, max, INTERACTION_RANGE)).toBeNull();
  });
});

describe('Door swing', () => {
  it('opens over 1.2 s and stays open', () => {
    const swing = new DoorSwing();
    expect(swing.open()).toBe(true);
    expect(swing.state).toBe('OPENING');
    swing.update(DOOR_SWING_SECONDS / 2);
    expect(swing.angle).toBeCloseTo(DOOR_OPEN_ANGLE / 2);
    swing.update(DOOR_SWING_SECONDS / 2);
    expect(swing.state).toBe('OPEN');
    expect(swing.angle).toBeCloseTo(DOOR_OPEN_ANGLE);
    expect(swing.open()).toBe(false);
  });
});
