import { z } from 'zod';

/** A seed is a non-empty string. Derivation from parent seeds is defined in Phase 5. */
export const Seed = z.string().min(1).max(128);
export type Seed = z.infer<typeof Seed>;

/** Independent seeds per subsystem, so changing one subsystem does not reshuffle the others. */
export const SeedSet = z.strictObject({
  houseSeed: Seed,
  journeySeed: Seed,
  roomSeed: Seed,
  worldSeed: Seed,
  visualSeed: Seed,
  physicsSeed: Seed,
  movementSeed: Seed,
  eventSeed: Seed,
  audioSeed: Seed,
});
export type SeedSet = z.infer<typeof SeedSet>;
