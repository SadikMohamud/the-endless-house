import type RAPIER from '@dimforge/rapier3d-compat';
import type { GeneratedForest } from '../gen/forest';
import type { Rapier } from '../platform/physics';

export const FRAME_POST = 0.14;
const BOUNDARY = 99;

/** Rotation about the vertical axis as a quaternion. */
export const yawQuat = (yaw: number) => ({
  x: 0,
  y: Math.sin(yaw / 2),
  z: 0,
  w: Math.cos(yaw / 2),
});

/** Yaw that turns local +Z towards the given horizontal direction. */
export const yawFacing = (dir: { x: number; z: number }) => Math.atan2(dir.x, dir.z);

/** Static colliders for a generated forest: ground, trunks, frame posts and the world boundary. */
export function buildForestColliders(
  rapier: Rapier,
  world: RAPIER.World,
  f: GeneratedForest,
): void {
  const { size, segments: n, heights } = f.terrain;

  // Rapier wants a column-major matrix (rows along Z, columns along X).
  const columnMajor = new Float32Array(heights.length);
  for (let ix = 0; ix <= n; ix++) {
    for (let iz = 0; iz <= n; iz++) columnMajor[ix * (n + 1) + iz] = heights[iz * (n + 1) + ix]!;
  }
  world.createCollider(
    rapier.ColliderDesc.heightfield(n, n, columnMajor, { x: size, y: 1, z: size }),
  );

  for (const t of f.trees) {
    const sink = 0.3;
    const half = (t.height + sink) / 2;
    world.createCollider(
      rapier.ColliderDesc.cylinder(half, t.radius).setTranslation(t.x, t.y - sink + half, t.z),
    );
  }

  // Frame posts are solid; the opening between them is not.
  const fr = f.returnFrame;
  const yaw = yawFacing(fr.facing);
  const rot = yawQuat(yaw);
  const offset = fr.width / 2 + FRAME_POST / 2;
  for (const side of [-1, 1]) {
    // Local +X after rotation by yaw is (cos yaw, -sin yaw).
    const px = fr.x + Math.cos(yaw) * offset * side;
    const pz = fr.z - Math.sin(yaw) * offset * side;
    world.createCollider(
      rapier.ColliderDesc.cuboid(FRAME_POST / 2, fr.height / 2 + 0.1, FRAME_POST / 2)
        .setTranslation(px, fr.y + fr.height / 2 - 0.1, pz)
        .setRotation(rot),
    );
  }

  // Invisible backstop at the edge of the world.
  for (const [x, z, hx, hz] of [
    [0, -BOUNDARY - 0.5, BOUNDARY + 1, 0.5],
    [0, BOUNDARY + 0.5, BOUNDARY + 1, 0.5],
    [-BOUNDARY - 0.5, 0, 0.5, BOUNDARY + 1],
    [BOUNDARY + 0.5, 0, 0.5, BOUNDARY + 1],
  ] as const) {
    world.createCollider(rapier.ColliderDesc.cuboid(hx, 60, hz).setTranslation(x, 30, z));
  }
}
