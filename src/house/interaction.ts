import type { Vec3 } from '../domain';

/** From the experience brief §4: the door responds within 1.5 m, while looking at it. */
export const INTERACTION_RANGE = 1.5;

/**
 * Distance along a ray to an axis-aligned box, or null if the ray misses it within `maxDist`.
 * `dir` must be normalised. Slab method.
 */
export function rayBoxDistance(
  origin: Vec3,
  dir: Vec3,
  min: Vec3,
  max: Vec3,
  maxDist: number,
): number | null {
  let near = 0;
  let far = maxDist;
  for (const axis of ['x', 'y', 'z'] as const) {
    const o = origin[axis];
    const d = dir[axis];
    if (Math.abs(d) < 1e-12) {
      if (o < min[axis] || o > max[axis]) return null;
      continue;
    }
    let t1 = (min[axis] - o) / d;
    let t2 = (max[axis] - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) return null;
  }
  return near;
}

/** Unit view direction for a first-person yaw and pitch (yaw 0 looks along -Z). */
export function viewDirection(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}
