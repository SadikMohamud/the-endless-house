import type { RealityConfiguration } from '../domain';
import { smoothstep, ValueNoise } from './noise';
import { Rng } from './rng';

/** Limits a generator must respect. Exceeding one is a generation failure, not a silent trim. */
export interface GenerationBudget {
  maxTrees: number;
  maxTerrainSegments: number;
}

export const DEFAULT_BUDGET: GenerationBudget = { maxTrees: 900, maxTerrainSegments: 128 };

export interface ForestContext {
  worldId: string;
  journeyId: string;
  reality: RealityConfiguration;
  /** Size of the return door frame, taken from the House DNA so it echoes the House door. */
  frame: { width: number; height: number };
  budget: GenerationBudget;
}

export interface Terrain {
  /** Edge length in metres; centred on the origin. */
  size: number;
  /** Quads per side. Heights has (segments + 1)^2 entries, row-major: index = iz * (n + 1) + ix. */
  segments: number;
  heights: Float32Array;
}

export interface Tree {
  x: number;
  y: number;
  z: number;
  height: number;
  radius: number;
  /** Height above the base where foliage starts. */
  crownBase: number;
  crownRadius: number;
}

export interface Clearing {
  x: number;
  z: number;
  radius: number;
}

export interface GeneratedForest {
  generatorVersion: string;
  seed: string;
  terrain: Terrain;
  clearings: Clearing[];
  trees: Tree[];
  /** Lone door frame: the way back. `facing` is the unit direction its open side faces. */
  returnFrame: {
    x: number;
    y: number;
    z: number;
    facing: { x: number; z: number };
    width: number;
    height: number;
  };
  /** Arrival point, in front of the frame and facing away from it. */
  spawn: { x: number; y: number; z: number; facing: { x: number; z: number } };
  stats: { treeCount: number; clearingCount: number; interiorRelief: number };
}

const SIZE = 200;
const HALF = SIZE / 2;
const MAX_RELIEF = 7.5;
const EDGE_START = 78;
const EDGE_RISE = 14;
const TREE_CELL = 4.5;
const TREE_LIMIT = 92;

// Exact unit vectors, so no trig is needed (see docs/DETERMINISM.md).
const COMPASS = [
  { x: 0, z: -1 },
  { x: Math.SQRT1_2, z: -Math.SQRT1_2 },
  { x: 1, z: 0 },
  { x: Math.SQRT1_2, z: Math.SQRT1_2 },
  { x: 0, z: 1 },
  { x: -Math.SQRT1_2, z: Math.SQRT1_2 },
  { x: -1, z: 0 },
  { x: -Math.SQRT1_2, z: -Math.SQRT1_2 },
] as const;

/** The forest generator. Pure and deterministic: same context and version, same forest. */
export function generateForest(ctx: ForestContext): GeneratedForest {
  const { reality, budget } = ctx;
  if (reality.worldType !== 'FOREST')
    throw new Error(`forest generator cannot build ${reality.worldType}`);
  const segments = budget.maxTerrainSegments;
  const seed = reality.seed;
  const rng = new Rng(`${seed}/forest`);
  const terrainNoise = new ValueNoise(`${seed}/terrain`);
  const gapNoise = new ValueNoise(`${seed}/gaps`);

  // Clearings first: the terrain flattens under them.
  const clearings: Clearing[] = [];
  const clearingCount = rng.int(1, 3);
  for (let attempt = 0; clearings.length < clearingCount && attempt < 200; attempt++) {
    const c = { x: rng.range(-60, 60), z: rng.range(-60, 60), radius: rng.range(9, 14) };
    const clear = clearings.every((o) => dist2(o, c) > sq(o.radius + c.radius + 6));
    if (clear) clearings.push(c);
  }

  const base = (x: number, z: number) => terrainNoise.fbm(x + HALF, z + HALF, 55, 4) * MAX_RELIEF;
  const clearingLevels = clearings.map((c) => base(c.x, c.z));
  const heightFn = (x: number, z: number) => {
    let h = base(x, z);
    clearings.forEach((c, i) => {
      const d = Math.sqrt((x - c.x) * (x - c.x) + (z - c.z) * (z - c.z));
      const flat = 1 - smoothstep(c.radius * 0.6, c.radius * 1.2, d);
      h += (clearingLevels[i]! - h) * flat;
    });
    // The ground rises gently towards the edge of the world.
    return h + smoothstep(EDGE_START, HALF, Math.max(Math.abs(x), Math.abs(z))) * EDGE_RISE;
  };

  const n = segments;
  const step = SIZE / n;
  const heights = new Float32Array((n + 1) * (n + 1));
  for (let iz = 0; iz <= n; iz++) {
    for (let ix = 0; ix <= n; ix++)
      heights[iz * (n + 1) + ix] = heightFn(-HALF + ix * step, -HALF + iz * step);
  }
  const terrain: Terrain = { size: SIZE, segments: n, heights };

  // Trees: one jittered candidate per cell, minus clearings and low-frequency gaps.
  const candidates: Array<{ x: number; z: number }> = [];
  const cells = Math.floor(SIZE / TREE_CELL);
  for (let cz = 0; cz < cells; cz++) {
    for (let cx = 0; cx < cells; cx++) {
      const x = -HALF + (cx + rng.range(0.15, 0.85)) * TREE_CELL;
      const z = -HALF + (cz + rng.range(0.15, 0.85)) * TREE_CELL;
      if (Math.max(Math.abs(x), Math.abs(z)) > TREE_LIMIT) continue;
      if (clearings.some((c) => dist2(c, { x, z }) < sq(c.radius + 1.5))) continue;
      if (gapNoise.fbm(x + HALF, z + HALF, 28, 2) < 0.36) continue;
      candidates.push({ x, z });
    }
  }
  const target = Math.min(rng.int(400, 900), budget.maxTrees);
  const chosen = rng.shuffle(candidates).slice(0, target);
  chosen.sort((a, b) => a.z - b.z || a.x - b.x);
  const trees: Tree[] = chosen.map(({ x, z }) => {
    const height = rng.range(18, 32);
    return {
      x,
      y: heightAt(terrain, x, z),
      z,
      height,
      radius: rng.range(0.22, 0.45),
      crownBase: height * rng.range(0.55, 0.7),
      crownRadius: rng.range(2.2, 3.6),
    };
  });

  // The way back stands in the first clearing; the visitor arrives facing away from it.
  const home = clearings[0]!;
  const facing = rng.pick(COMPASS);
  const spawnX = home.x + facing.x * 2.5;
  const spawnZ = home.z + facing.z * 2.5;
  const returnFrame = {
    x: home.x,
    y: heightAt(terrain, home.x, home.z),
    z: home.z,
    facing: { x: facing.x, z: facing.z },
    width: ctx.frame.width,
    height: ctx.frame.height,
  };

  let lo = Infinity;
  let hi = -Infinity;
  for (let iz = 0; iz <= n; iz++) {
    for (let ix = 0; ix <= n; ix++) {
      const x = -HALF + ix * step;
      const z = -HALF + iz * step;
      if (Math.max(Math.abs(x), Math.abs(z)) > EDGE_START) continue;
      const h = heights[iz * (n + 1) + ix]!;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }

  const forest: GeneratedForest = {
    generatorVersion: reality.generatorVersion,
    seed,
    terrain,
    clearings,
    trees,
    returnFrame,
    spawn: {
      x: spawnX,
      y: heightAt(terrain, spawnX, spawnZ),
      z: spawnZ,
      facing: { x: facing.x, z: facing.z },
    },
    stats: { treeCount: trees.length, clearingCount: clearings.length, interiorRelief: hi - lo },
  };
  validateForest(forest, budget);
  return forest;
}

/** Resource and sanity checks on generator output. */
function validateForest(f: GeneratedForest, budget: GenerationBudget): void {
  if (f.trees.length > budget.maxTrees) throw new Error('forest exceeds tree budget');
  if (f.terrain.segments > budget.maxTerrainSegments) throw new Error('terrain exceeds budget');
  if (f.clearings.length < 1) throw new Error('forest has no clearing for the way back');
  for (const h of f.terrain.heights) if (!Number.isFinite(h)) throw new Error('non-finite terrain');
}

const sq = (v: number) => v * v;

/** Squared distance: avoids Math.hypot, whose rounding may differ between engines. */
const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  (a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z);

/** Ground height at (x, z) by bilinear interpolation of the terrain grid. */
export function heightAt(t: Terrain, x: number, z: number): number {
  const n = t.segments;
  const step = t.size / n;
  const gx = Math.min(n - 1e-9, Math.max(0, (x + t.size / 2) / step));
  const gz = Math.min(n - 1e-9, Math.max(0, (z + t.size / 2) / step));
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const at = (i: number, j: number) => t.heights[j * (n + 1) + i]!;
  const top = at(ix, iz) + (at(ix + 1, iz) - at(ix, iz)) * fx;
  const bottom = at(ix, iz + 1) + (at(ix + 1, iz + 1) - at(ix, iz + 1)) * fx;
  return top + (bottom - top) * fz;
}
