import { z } from 'zod';
import { HexColour, Vec3 } from './common';
import { Seed } from './seed';

// Each list holds only the values Milestone 1 supports. Extending the House means adding
// entries here, then teaching the runtime and generators about them.

export const WorldType = z.enum(['FOREST']);
export type WorldType = z.infer<typeof WorldType>;

export const VisualProfileId = z.enum(['NATURAL']);
export const PhysicsProfileId = z.enum(['EARTH', 'LOW_GRAVITY']);
export const MovementProfileId = z.enum(['WALK', 'STANDARD']);
export const TimeProfileId = z.enum(['NORMAL']);
export const MaterialProfileId = z.enum(['FOREST_NATURAL']);
export const LightingProfileId = z.enum(['OVERCAST', 'LOW_SUN']);
export const AudioProfileId = z.enum(['SILENT']);
export const DangerProfileId = z.enum(['NONE']);
export const RarityTier = z.enum(['COMMON']);

export type PhysicsProfileId = z.infer<typeof PhysicsProfileId>;
export type MovementProfileId = z.infer<typeof MovementProfileId>;

export const VisualRealityProfile = z.strictObject({ id: VisualProfileId });
export type VisualRealityProfile = z.infer<typeof VisualRealityProfile>;

/** Values the physics runtime applies directly. Every field changes runtime behaviour. */
export const PhysicsProfile = z
  .strictObject({
    id: PhysicsProfileId,
    /** m/s². Stored as a vector so directional gravity can arrive without a schema change. */
    gravity: Vec3,
    /** Air resistance on the airborne visitor, per second. */
    linearDamping: z.number().min(0).max(10),
    /** Ground grip, 0 to 2: scales how quickly the visitor stops. */
    friction: z.number().min(0).max(2),
    /** Simulation speed multiplier. */
    timeScale: z.number().positive().max(4),
  })
  .refine(
    (p) => Math.hypot(p.gravity.x, p.gravity.y, p.gravity.z) <= 30,
    'gravity magnitude must not exceed 30 m/s²',
  )
  // The character controller's up axis is fixed to +Y. Sideways gravity would be silently
  // ignored, so it is rejected until directional gravity is implemented.
  .refine(
    (p) => p.gravity.x === 0 && p.gravity.z === 0 && p.gravity.y <= 0,
    'gravity must point straight down until directional gravity is supported',
  );
export type PhysicsProfile = z.infer<typeof PhysicsProfile>;

/**
 * How the visitor moves. Jump height and air time are not stored: they emerge from
 * jumpSpeed under the active physics profile's gravity.
 */
export const MovementProfile = z.strictObject({
  id: MovementProfileId,
  walkSpeed: z.number().positive().max(20),
  /** null disables sprinting. */
  sprintSpeed: z.number().positive().max(40).nullable(),
  /** Initial upward speed in m/s. null disables jumping. */
  jumpSpeed: z.number().positive().max(20).nullable(),
  /** m/s² towards the target speed while moving on the ground. */
  acceleration: z.number().positive().max(100),
  /** m/s² towards rest on the ground, before friction scaling. */
  deceleration: z.number().positive().max(100),
  /** Fraction of ground acceleration available in the air, 0 to 1. */
  airControl: z.number().min(0).max(1),
  eyeHeight: z.number().positive().max(3),
  capsuleRadius: z.number().positive().max(1),
});
export type MovementProfile = z.infer<typeof MovementProfile>;

export const TimeProfile = z.strictObject({ id: TimeProfileId });
export type TimeProfile = z.infer<typeof TimeProfile>;

export const EnvironmentProfile = z
  .strictObject({
    fogColour: HexColour,
    /** Distance in metres where fog begins. */
    fogNear: z.number().min(0),
    /** Distance in metres where fog is opaque. */
    fogFar: z.number().positive().max(1000),
  })
  .refine((e) => e.fogNear < e.fogFar, 'fogNear must be less than fogFar');
export type EnvironmentProfile = z.infer<typeof EnvironmentProfile>;

export const MaterialProfile = z.strictObject({
  id: MaterialProfileId,
  palette: z.record(z.string(), HexColour),
});
export type MaterialProfile = z.infer<typeof MaterialProfile>;

export const LightingProfile = z.strictObject({
  id: LightingProfileId,
  /** Sun elevation above the horizon, degrees. */
  sunElevation: z.number().min(0).max(90),
  /** Sun compass direction, degrees. */
  sunAzimuth: z.number().min(0).lt(360),
  sunColour: HexColour,
  sunIntensity: z.number().min(0).max(10),
  ambientIntensity: z.number().min(0).max(10),
});
export type LightingProfile = z.infer<typeof LightingProfile>;

export const AudioProfile = z.strictObject({ id: AudioProfileId });
export type AudioProfile = z.infer<typeof AudioProfile>;

export const DangerProfile = z.strictObject({ id: DangerProfileId });
export type DangerProfile = z.infer<typeof DangerProfile>;

export const RarityProfile = z.strictObject({ tier: RarityTier });
export type RarityProfile = z.infer<typeof RarityProfile>;

/** A semantic version string, e.g. `forest@1.0.0`. */
export const GeneratorVersion = z.string().regex(/^[a-z][a-z0-9-]*@\d+\.\d+\.\d+$/);
export type GeneratorVersion = z.infer<typeof GeneratorVersion>;

/** Everything needed to generate and run one world. Same values + same version = same world. */
export const RealityConfiguration = z.strictObject({
  worldType: WorldType,
  visualProfile: VisualRealityProfile,
  physicsProfile: PhysicsProfile,
  movementProfile: MovementProfile,
  timeProfile: TimeProfile,
  environmentProfile: EnvironmentProfile,
  materialProfile: MaterialProfile,
  lightingProfile: LightingProfile,
  audioProfile: AudioProfile,
  dangerProfile: DangerProfile,
  rarityProfile: RarityProfile,
  seed: Seed,
  generatorVersion: GeneratorVersion,
});
export type RealityConfiguration = z.infer<typeof RealityConfiguration>;

// Built-in profiles. Validated at module load so a bad edit fails immediately.

export const PHYSICS_PROFILES: Readonly<Record<PhysicsProfileId, PhysicsProfile>> = {
  EARTH: PhysicsProfile.parse({
    id: 'EARTH',
    gravity: { x: 0, y: -9.81, z: 0 },
    linearDamping: 0,
    friction: 0.8,
    timeScale: 1,
  }),
  LOW_GRAVITY: PhysicsProfile.parse({
    id: 'LOW_GRAVITY',
    gravity: { x: 0, y: -2.5, z: 0 },
    linearDamping: 0.05,
    friction: 0.6,
    timeScale: 1,
  }),
};

/** From the experience brief: walk 1.5 m/s, Shift 3.0 m/s in worlds, no sprint or jump in the House. */
export const MOVEMENT_PROFILES: Readonly<Record<MovementProfileId, MovementProfile>> = {
  WALK: MovementProfile.parse({
    id: 'WALK',
    walkSpeed: 1.5,
    sprintSpeed: null,
    jumpSpeed: null,
    // Gentle start and stop: the House is walked slowly.
    acceleration: 6,
    deceleration: 8,
    airControl: 0,
    eyeHeight: 1.65,
    capsuleRadius: 0.3,
  }),
  STANDARD: MovementProfile.parse({
    id: 'STANDARD',
    walkSpeed: 1.5,
    sprintSpeed: 3.0,
    jumpSpeed: 4.0,
    acceleration: 10,
    deceleration: 12,
    airControl: 0.3,
    eyeHeight: 1.65,
    capsuleRadius: 0.3,
  }),
};
