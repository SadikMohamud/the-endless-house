import { describe, expect, it } from 'vitest';
import { DEFAULT_HOUSE_DNA, RealityConfiguration } from '../src/domain';
import { DEFAULT_BUDGET, generateForest, heightAt, type GeneratedForest } from '../src/gen/forest';
import { FOREST_GENERATOR_VERSION, planWorld } from '../src/gen/planner';
import { deriveSeed, hash128, Rng } from '../src/gen/rng';
import { deriveDoorSeeds, seedsFromWorldSeed } from '../src/gen/seeds';

const forestFor = (worldSeed: string): GeneratedForest =>
  generateForest({
    worldId: 'w',
    journeyId: 'j',
    reality: planWorld(seedsFromWorldSeed(worldSeed)),
    frame: { width: DEFAULT_HOUSE_DNA.doorWidth, height: DEFAULT_HOUSE_DNA.doorHeight },
    budget: DEFAULT_BUDGET,
  });

describe('seeded RNG', () => {
  it('produces pinned values (changing these means changing every world: bump generator versions)', () => {
    expect(hash128('the-endless-house')).toMatchSnapshot();
    const rng = new Rng('the-endless-house');
    expect([rng.nextUint32(), rng.nextUint32(), rng.nextUint32()]).toMatchSnapshot();
  });

  it('is reproducible and seed-sensitive', () => {
    const a = new Rng('a');
    const a2 = new Rng('a');
    const b = new Rng('b');
    const seqA = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => a2.next())).toEqual(seqA);
    expect(Array.from({ length: 20 }, () => b.next())).not.toEqual(seqA);
  });

  it('stays within requested bounds', () => {
    const rng = new Rng('bounds');
    for (let i = 0; i < 10000; i++) {
      const v = rng.next();
      expect(v >= 0 && v < 1).toBe(true);
      const n = rng.int(400, 900);
      expect(n >= 400 && n <= 900 && Number.isInteger(n)).toBe(true);
    }
  });

  it('derives distinct, stable child seeds', () => {
    expect(deriveSeed('p', 'x')).toBe(deriveSeed('p', 'x'));
    expect(deriveSeed('p', 'x')).not.toBe(deriveSeed('p', 'y'));
    expect(deriveSeed('p', 'x')).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('seed sets', () => {
  const ctx = {
    houseSeed: 'h',
    journeySeed: 'j1',
    roomId: 'door-room',
    doorId: 'door-1',
    visit: 0,
  };

  it('gives every subsystem its own seed', () => {
    const seeds = deriveDoorSeeds(ctx);
    const subsystem = [
      seeds.visualSeed,
      seeds.physicsSeed,
      seeds.movementSeed,
      seeds.eventSeed,
      seeds.audioSeed,
    ];
    expect(new Set([seeds.worldSeed, ...subsystem]).size).toBe(6);
  });

  it('sends the same door somewhere different on another journey or another visit', () => {
    const first = deriveDoorSeeds(ctx).worldSeed;
    expect(deriveDoorSeeds(ctx).worldSeed).toBe(first);
    expect(deriveDoorSeeds({ ...ctx, journeySeed: 'j2' }).worldSeed).not.toBe(first);
    expect(deriveDoorSeeds({ ...ctx, visit: 1 }).worldSeed).not.toBe(first);
  });
});

describe('deterministic planner', () => {
  it('produces a valid, reproducible configuration', () => {
    const seeds = seedsFromWorldSeed('plan-1');
    const plan = planWorld(seeds);
    expect(RealityConfiguration.safeParse(plan).success).toBe(true);
    expect(planWorld(seeds)).toEqual(plan);
    expect(plan.generatorVersion).toBe(FOREST_GENERATOR_VERSION);
    expect(plan.seed).toBe(seeds.worldSeed);
  });

  it('keeps fog within the brief and mixes physics profiles at the planned odds', () => {
    let low = 0;
    const N = 500;
    for (let i = 0; i < N; i++) {
      const plan = planWorld(seedsFromWorldSeed(`odds-${i}`));
      expect(plan.environmentProfile.fogFar).toBeGreaterThanOrEqual(60);
      expect(plan.environmentProfile.fogFar).toBeLessThanOrEqual(80);
      if (plan.physicsProfile.id === 'LOW_GRAVITY') low++;
    }
    // Planned 30%; allow sampling noise.
    expect(low / N).toBeGreaterThan(0.22);
    expect(low / N).toBeLessThan(0.38);
  });
});

describe('forest generator', () => {
  // AT-05: a valid configuration and seed produce an explorable 3D world.
  it('AT-05: generates real terrain, trees, clearings and a way back', () => {
    const f = forestFor('at-05');
    const n = f.terrain.segments;
    expect(f.terrain.size).toBe(200);
    expect(f.terrain.heights.length).toBe((n + 1) * (n + 1));
    expect(f.stats.interiorRelief).toBeGreaterThan(0.5);
    expect(f.stats.interiorRelief).toBeLessThanOrEqual(8);
    expect(f.trees.length).toBeGreaterThanOrEqual(400);
    expect(f.trees.length).toBeLessThanOrEqual(900);
    expect(f.clearings.length).toBeGreaterThanOrEqual(1);
    expect(f.clearings.length).toBeLessThanOrEqual(3);
  });

  it('AT-05: holds its invariants across 50 seeds', () => {
    for (let i = 0; i < 50; i++) {
      const f = forestFor(`invariants-${i}`);
      const label = `seed invariants-${i}`;
      expect(f.trees.length, label).toBeGreaterThanOrEqual(400);
      expect(f.trees.length, label).toBeLessThanOrEqual(900);
      expect(f.stats.interiorRelief, label).toBeLessThanOrEqual(8);

      // The way back stands in a clearing, and no tree stands in any clearing.
      const home = f.clearings[0]!;
      expect(Math.hypot(f.returnFrame.x - home.x, f.returnFrame.z - home.z), label).toBeLessThan(
        home.radius,
      );
      for (const t of f.trees) {
        for (const c of f.clearings) {
          expect(Math.hypot(t.x - c.x, t.z - c.z), label).toBeGreaterThan(c.radius);
        }
        // Trees stand on the ground.
        expect(t.y).toBeCloseTo(heightAt(f.terrain, t.x, t.z), 5);
      }

      // The visitor arrives in front of the frame, facing away from it.
      const away = { x: f.spawn.x - f.returnFrame.x, z: f.spawn.z - f.returnFrame.z };
      expect(away.x * f.spawn.facing.x + away.z * f.spawn.facing.z, label).toBeGreaterThan(2);
      expect(Math.hypot(f.spawn.facing.x, f.spawn.facing.z)).toBeCloseTo(1, 12);
    }
  });

  it('uses the House door size for the return frame', () => {
    const f = forestFor('frame');
    expect(f.returnFrame.width).toBe(DEFAULT_HOUSE_DNA.doorWidth);
    expect(f.returnFrame.height).toBe(DEFAULT_HOUSE_DNA.doorHeight);
  });

  // AT-06: same seed, configuration and version give equivalent structure.
  it('AT-06: is reproducible', () => {
    const a = forestFor('at-06');
    const b = forestFor('at-06');
    expect(b).toEqual(a);
    expect(Array.from(b.terrain.heights)).toEqual(Array.from(a.terrain.heights));
  });

  it('AT-06: matches a pinned fingerprint (a change here requires a generator version bump)', () => {
    const f = forestFor('golden');
    expect({
      version: f.generatorVersion,
      treeCount: f.stats.treeCount,
      clearings: f.clearings,
      firstTree: f.trees[0],
      lastTree: f.trees[f.trees.length - 1],
      terrainSample: [f.terrain.heights[0], f.terrain.heights[8256], f.terrain.heights[16640]],
      frame: f.returnFrame,
    }).toMatchSnapshot();
  });

  // AT-07: distinct seeds can produce meaningful variation.
  it('AT-07: varies with the seed', () => {
    const a = forestFor('at-07-a');
    const b = forestFor('at-07-b');
    expect(Array.from(b.terrain.heights)).not.toEqual(Array.from(a.terrain.heights));
    expect(b.trees.map((t) => [t.x, t.z])).not.toEqual(a.trees.map((t) => [t.x, t.z]));
    expect(b.clearings).not.toEqual(a.clearings);
  });

  it('rejects a non-forest configuration and respects the budget', () => {
    const reality = planWorld(seedsFromWorldSeed('budget'));
    const ctx = {
      worldId: 'w',
      journeyId: 'j',
      reality,
      frame: { width: 1, height: 2.4 },
      budget: { maxTrees: 50, maxTerrainSegments: 64 },
    };
    const f = generateForest(ctx);
    expect(f.trees.length).toBeLessThanOrEqual(50);
    expect(f.terrain.segments).toBe(64);
    expect(() =>
      generateForest({ ...ctx, reality: { ...reality, worldType: 'DESERT' as 'FOREST' } }),
    ).toThrow();
  });

  it('generates quickly', () => {
    const t0 = performance.now();
    forestFor('timing');
    const ms = performance.now() - t0;
    console.log(`forest generation: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(1000);
  });
});
