import type RAPIER from '@dimforge/rapier3d-compat';
import type { MovementProfile, PhysicsProfile, Vec3 } from '../domain';
import type { Rapier } from '../platform/physics';

/** What the visitor wants to do this step, independent of keyboard or mouse. */
export interface MoveIntent {
  /** -1 back, 0, 1 forward. */
  forward: number;
  /** -1 left, 0, 1 right. */
  right: number;
  sprint: boolean;
  /** True only on the step the jump key was pressed. */
  jump: boolean;
}

export const NO_INTENT: MoveIntent = { forward: 0, right: 0, sprint: false, jump: false };

const CAPSULE_HEIGHT = 1.8;
/**
 * Spawn this far above the requested feet position. A capsule that starts exactly touching
 * the ground is treated as penetrating and can fall through it.
 */
const SPAWN_CLEARANCE = 0.05;
const PITCH_LIMIT = (85 * Math.PI) / 180;

export interface PlayerOptions {
  /** Position of the visitor's feet. */
  position: Vec3;
  /** Radians about the vertical axis. 0 faces -Z. */
  yaw: number;
  movement: MovementProfile;
  physics: PhysicsProfile;
}

/**
 * First-person visitor on a Rapier kinematic character controller.
 * Contains no DOM code so it runs under Node tests against real collision.
 */
export class Player {
  yaw: number;
  pitch = 0;
  grounded = false;
  /** Current velocity in m/s (simulation time). */
  readonly velocity = { x: 0, y: 0, z: 0 };
  movement: MovementProfile;
  physics: PhysicsProfile;

  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly halfHeight: number;
  private readonly radius: number;

  constructor(
    rapier: Rapier,
    private readonly world: RAPIER.World,
    options: PlayerOptions,
  ) {
    this.yaw = options.yaw;
    this.movement = options.movement;
    this.physics = options.physics;
    this.radius = options.movement.capsuleRadius;
    this.halfHeight = CAPSULE_HEIGHT / 2 - this.radius;

    const p = options.position;
    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(
        p.x,
        p.y + CAPSULE_HEIGHT / 2 + SPAWN_CLEARANCE,
        p.z,
      ),
    );
    // Collider friction is ignored by the character controller; the profile's friction
    // is applied to deceleration in fixedStep instead.
    this.collider = world.createCollider(
      rapier.ColliderDesc.capsule(this.halfHeight, this.radius),
      this.body,
    );

    this.controller = world.createCharacterController(0.01);
    this.controller.setSlideEnabled(true);
    this.controller.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((50 * Math.PI) / 180);
    this.controller.enableAutostep(0.3, 0.2, true);
    this.controller.enableSnapToGround(0.3);
  }

  /** Mouse look, in radians. */
  look(deltaYaw: number, deltaPitch: number): void {
    this.yaw -= deltaYaw;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - deltaPitch));
  }

  /**
   * Computes and queues this step's movement. The caller then steps the physics world,
   * which applies it.
   */
  fixedStep(intent: MoveIntent, dt: number): void {
    const step = dt * this.physics.timeScale;
    const { movement, physics, velocity: v } = this;

    // Target horizontal velocity: camera-relative, normalised so diagonals are not faster.
    let fx = 0;
    let fz = 0;
    const len = Math.hypot(intent.forward, intent.right);
    if (len > 0) {
      const f = intent.forward / len;
      const r = intent.right / len;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // Forward is -Z at yaw 0; right is +X.
      fx = -sin * f + cos * r;
      fz = -cos * f - sin * r;
    }
    const speed =
      intent.sprint && movement.sprintSpeed !== null ? movement.sprintSpeed : movement.walkSpeed;

    // Momentum: ease towards the target. On the ground, friction sets how fast you stop;
    // in the air, only airControl of the acceleration is available.
    const rate = this.grounded
      ? len > 0
        ? movement.acceleration
        : movement.deceleration * physics.friction
      : movement.acceleration * movement.airControl;
    const dx = fx * speed - v.x;
    const dz = fz * speed - v.z;
    const gap = Math.hypot(dx, dz);
    const maxChange = rate * step;
    if (gap <= maxChange) {
      v.x += dx;
      v.z += dz;
    } else if (gap > 0) {
      v.x += (dx / gap) * maxChange;
      v.z += (dz / gap) * maxChange;
    }

    // Vertical: gravity from the active profile; jump only if the movement profile allows it.
    if (this.grounded && intent.jump && movement.jumpSpeed !== null) {
      v.y = movement.jumpSpeed;
    } else {
      v.y += physics.gravity.y * step;
    }

    // Air resistance while airborne.
    if (!this.grounded || v.y > 0) {
      const keep = Math.max(0, 1 - physics.linearDamping * step);
      v.x *= keep;
      v.y *= keep;
      v.z *= keep;
    }

    const desired = { x: v.x * step, y: v.y * step, z: v.z * step };
    this.controller.computeColliderMovement(this.collider, desired);
    const moved = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();

    if (this.grounded && v.y < 0) v.y = 0;
    // Head hit something: stop rising.
    if (v.y > 0 && moved.y < desired.y - 1e-4) v.y = 0;
    // Walls: remove the part of the velocity that drives into each wall hit this step, so
    // speed cannot build up against it while sliding along it is kept. Floor and ceiling
    // contacts (mostly vertical normals) are ignored. The sign check against the desired
    // move means the normal's orientation does not matter.
    for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
      const n = this.controller.computedCollision(i)?.normal1;
      if (!n || Math.abs(n.y) > 0.7) continue;
      const len = Math.hypot(n.x, n.z);
      if (len < 1e-6) continue;
      const nx = n.x / len;
      const nz = n.z / len;
      const into = v.x * nx + v.z * nz;
      if (into * (desired.x * nx + desired.z * nz) > 0) {
        v.x -= into * nx;
        v.z -= into * nz;
      }
    }

    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + moved.x, y: t.y + moved.y, z: t.z + moved.z });
  }

  /** Position of the visitor's feet. */
  get feet(): Vec3 {
    const t = this.body.translation();
    return { x: t.x, y: t.y - CAPSULE_HEIGHT / 2, z: t.z };
  }

  get eye(): Vec3 {
    const f = this.feet;
    return { x: f.x, y: f.y + this.movement.eyeHeight, z: f.z };
  }

  dispose(): void {
    this.world.removeCharacterController(this.controller);
    this.world.removeRigidBody(this.body);
  }
}
