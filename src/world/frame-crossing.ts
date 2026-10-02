import type { GeneratedForest } from '../gen/forest';

type Frame = GeneratedForest['returnFrame'];
type Point = { x: number; y: number; z: number };

/**
 * True if moving from `prev` to `cur` passed through the frame's opening, in either direction:
 * the path crosses the frame's plane between the posts, below the lintel.
 */
export function crossedFrame(prev: Point, cur: Point, f: Frame): boolean {
  const side = (p: Point) => (p.x - f.x) * f.facing.x + (p.z - f.z) * f.facing.z;
  const a = side(prev);
  const b = side(cur);
  if (a === b || (a > 0 && b > 0) || (a < 0 && b < 0)) return false;
  // Where along the path the plane is crossed, then how far across the opening that is.
  const t = a / (a - b);
  const x = prev.x + (cur.x - prev.x) * t;
  const z = prev.z + (cur.z - prev.z) * t;
  const y = prev.y + (cur.y - prev.y) * t;
  const lateral = (x - f.x) * f.facing.z - (z - f.z) * f.facing.x;
  return Math.abs(lateral) < f.width / 2 && y > f.y - 0.5 && y < f.y + f.height;
}
