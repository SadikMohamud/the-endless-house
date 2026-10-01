import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOUSE_DNA,
  House,
  HouseDNA,
  Journey,
  MOVEMENT_PROFILES,
  PHYSICS_PROFILES,
  RealityConfiguration,
  SeedSet,
  World,
} from '../src/domain';

const forestConfig = (): RealityConfiguration => ({
  worldType: 'FOREST',
  visualProfile: { id: 'NATURAL' },
  physicsProfile: PHYSICS_PROFILES.EARTH,
  movementProfile: MOVEMENT_PROFILES.STANDARD,
  timeProfile: { id: 'NORMAL' },
  environmentProfile: { fogColour: '#B9C4C0', fogNear: 20, fogFar: 70 },
  materialProfile: {
    id: 'FOREST_NATURAL',
    palette: { trunk: '#3A332C', foliage: '#2F4A36', ground: '#4B4A3A' },
  },
  lightingProfile: {
    id: 'OVERCAST',
    sunElevation: 35,
    sunAzimuth: 120,
    sunColour: '#E8ECEA',
    sunIntensity: 1,
    ambientIntensity: 0.6,
  },
  audioProfile: { id: 'SILENT' },
  dangerProfile: { id: 'NONE' },
  rarityProfile: { tier: 'COMMON' },
  seed: 'test-seed',
  generatorVersion: 'forest@1.0.0',
});

describe('House DNA', () => {
  it('matches the experience brief values', () => {
    expect(DEFAULT_HOUSE_DNA).toMatchObject({
      ceilingHeight: 4.2,
      corridorWidth: 2.2,
      corridorLength: 14,
      doorWidth: 1.0,
      doorHeight: 2.4,
      firstRoom: { width: 8, depth: 10 },
      panellingHeight: 1.1,
    });
    expect(DEFAULT_HOUSE_DNA.palette.door).toBe('#2A1E17');
    expect(DEFAULT_HOUSE_DNA.lighting.lampColour).toBe('#FFB36B');
  });

  it('rejects a door taller than the ceiling', () => {
    const result = HouseDNA.safeParse({ ...DEFAULT_HOUSE_DNA, doorHeight: 5 });
    expect(result.success).toBe(false);
  });

  it('rejects a door wider than the corridor', () => {
    expect(HouseDNA.safeParse({ ...DEFAULT_HOUSE_DNA, doorWidth: 3 }).success).toBe(false);
  });

  it('rejects an invalid colour', () => {
    const palette = { ...DEFAULT_HOUSE_DNA.palette, floor: 'brown' };
    expect(HouseDNA.safeParse({ ...DEFAULT_HOUSE_DNA, palette }).success).toBe(false);
  });
});

describe('House', () => {
  const house = (): House => ({
    houseId: 'house-1',
    seed: 'h',
    dna: DEFAULT_HOUSE_DNA,
    rooms: [{ id: 'start', kind: 'ROOM', min: { x: 0, y: 0, z: 0 }, max: { x: 8, y: 4.2, z: 10 } }],
    doors: [
      {
        id: 'door-1',
        type: 'PRIVATE_WORLD',
        state: 'CLOSED',
        roomId: 'start',
        position: { x: 4, y: 0, z: 0 },
        facing: 0,
      },
    ],
    spawn: { roomId: 'start', position: { x: 4, y: 0, z: 8 }, facing: Math.PI },
  });

  it('accepts a consistent house', () => {
    expect(House.safeParse(house()).success).toBe(true);
  });

  it('rejects a door in an unknown room', () => {
    const h = house();
    h.doors[0]!.roomId = 'nowhere';
    expect(House.safeParse(h).success).toBe(false);
  });

  it('rejects an inverted room volume', () => {
    const h = house();
    h.rooms[0]!.max.y = -1;
    expect(House.safeParse(h).success).toBe(false);
  });
});

describe('RealityConfiguration', () => {
  it('accepts a valid forest configuration', () => {
    const result = RealityConfiguration.safeParse(forestConfig());
    expect(result.success).toBe(true);
  });

  it('rejects unknown fields', () => {
    const result = RealityConfiguration.safeParse({ ...forestConfig(), execute: 'rm -rf /' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields nested inside a profile', () => {
    const config = forestConfig();
    const physicsProfile = { ...config.physicsProfile, owner: 'someone-else' };
    expect(RealityConfiguration.safeParse({ ...config, physicsProfile }).success).toBe(false);
  });

  it('rejects an unsupported world type', () => {
    const result = RealityConfiguration.safeParse({ ...forestConfig(), worldType: 'DESERT' });
    expect(result.success).toBe(false);
  });

  it('rejects gravity above the allowed magnitude', () => {
    const config = forestConfig();
    const physicsProfile = { ...config.physicsProfile, gravity: { x: 0, y: -50, z: 0 } };
    expect(RealityConfiguration.safeParse({ ...config, physicsProfile }).success).toBe(false);
  });

  it('rejects fog that starts beyond where it ends', () => {
    const config = forestConfig();
    const environmentProfile = { ...config.environmentProfile, fogNear: 90, fogFar: 60 };
    expect(RealityConfiguration.safeParse({ ...config, environmentProfile }).success).toBe(false);
  });

  it('rejects a malformed generator version', () => {
    const result = RealityConfiguration.safeParse({ ...forestConfig(), generatorVersion: 'v1' });
    expect(result.success).toBe(false);
  });
});

describe('built-in profiles', () => {
  it('EARTH and LOW_GRAVITY have different downward gravity', () => {
    expect(PHYSICS_PROFILES.EARTH.gravity.y).toBeCloseTo(-9.81);
    expect(PHYSICS_PROFILES.LOW_GRAVITY.gravity.y).toBeGreaterThan(
      PHYSICS_PROFILES.EARTH.gravity.y,
    );
    expect(PHYSICS_PROFILES.LOW_GRAVITY.gravity.y).toBeLessThan(0);
  });

  it('House walking has no sprint or jump; world movement has both', () => {
    expect(MOVEMENT_PROFILES.WALK).toMatchObject({
      walkSpeed: 1.5,
      sprintSpeed: null,
      jumpSpeed: null,
    });
    expect(MOVEMENT_PROFILES.STANDARD).toMatchObject({ walkSpeed: 1.5, sprintSpeed: 3.0 });
    expect(MOVEMENT_PROFILES.STANDARD.jumpSpeed).not.toBeNull();
  });
});

describe('SeedSet', () => {
  it('requires every subsystem seed', () => {
    const seeds = {
      houseSeed: 'a',
      journeySeed: 'b',
      roomSeed: 'c',
      worldSeed: 'd',
      visualSeed: 'e',
      physicsSeed: 'f',
      movementSeed: 'g',
      eventSeed: 'h',
      audioSeed: 'i',
    };
    expect(SeedSet.safeParse(seeds).success).toBe(true);
    const missing: Partial<typeof seeds> = { ...seeds };
    delete missing.audioSeed;
    expect(SeedSet.safeParse(missing).success).toBe(false);
  });
});

describe('World', () => {
  it('only supports geometry worlds for now', () => {
    const world = {
      worldId: 'w1',
      journeyId: 'j1',
      representation: 'GEOMETRY_WORLD',
      reality: forestConfig(),
    };
    expect(World.safeParse(world).success).toBe(true);
    expect(World.safeParse({ ...world, representation: 'SPLAT_WORLD' }).success).toBe(false);
  });

  it('rejects ids outside the safe character set', () => {
    const world = {
      worldId: '../other-visitor',
      journeyId: 'j1',
      representation: 'GEOMETRY_WORLD',
      reality: forestConfig(),
    };
    expect(World.safeParse(world).success).toBe(false);
  });
});

describe('Journey', () => {
  const journey = (): Journey => ({
    journeyId: 'j1',
    visitorId: 'v1',
    houseId: 'house-1',
    worldId: 'w1',
    seed: 's',
    state: 'ACTIVE',
    location: { kind: 'WORLD', worldId: 'w1' },
    returnState: 'AVAILABLE',
    history: [
      { type: 'JOURNEY_STARTED', sequence: 0 },
      { type: 'DOOR_OPENED', sequence: 1, doorId: 'door-1' },
      { type: 'WORLD_ENTERED', sequence: 2, worldId: 'w1' },
    ],
  });

  it('accepts a consistent journey', () => {
    expect(Journey.safeParse(journey()).success).toBe(true);
  });

  it('rejects an unknown location kind', () => {
    const j = { ...journey(), location: { kind: 'NOWHERE' } };
    expect(Journey.safeParse(j).success).toBe(false);
  });

  it('rejects a location pointing at a different world', () => {
    const j = { ...journey(), location: { kind: 'WORLD' as const, worldId: 'w2' } };
    expect(Journey.safeParse(j).success).toBe(false);
  });

  it('rejects history with gaps in its sequence', () => {
    const j = journey();
    j.history[2]!.sequence = 5;
    expect(Journey.safeParse(j).success).toBe(false);
  });
});
