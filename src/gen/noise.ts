import { hash128 } from './rng';

/**
 * Seeded 2D value noise with fractal octaves. Uses only integer hashing, + - * / and
 * Math.floor, so it is bit-identical across engines (no trig, no pow).
 */
export class ValueNoise {
  private readonly salt: number;

  constructor(seed: string) {
    this.salt = hash128(seed)[0];
  }

  /** Lattice value in [0, 1). */
  private lattice(ix: number, iz: number): number {
    let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + this.salt) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  /** Smooth noise in [0, 1) at a point, with lattice spacing 1. */
  sample(x: number, z: number): number {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const a = this.lattice(ix, iz);
    const b = this.lattice(ix + 1, iz);
    const c = this.lattice(ix, iz + 1);
    const d = this.lattice(ix + 1, iz + 1);
    const top = a + (b - a) * sx;
    const bottom = c + (d - c) * sx;
    return top + (bottom - top) * sz;
  }

  /** Fractal sum of octaves, normalised to [0, 1). `scale` is the base feature size in metres. */
  fbm(x: number, z: number, scale: number, octaves = 4): number {
    let amplitude = 1;
    let frequency = 1 / scale;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amplitude * this.sample(x * frequency + o * 17.13, z * frequency - o * 9.71);
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return sum / norm;
  }
}

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
