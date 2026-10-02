import { SeedSet } from '../domain';
import { deriveSeed } from './rng';

/** Subsystem seeds derived from one world seed. Each subsystem changes independently. */
export function subsystemSeeds(worldSeed: string) {
  return {
    visualSeed: deriveSeed(worldSeed, 'visual'),
    physicsSeed: deriveSeed(worldSeed, 'physics'),
    movementSeed: deriveSeed(worldSeed, 'movement'),
    eventSeed: deriveSeed(worldSeed, 'event'),
    audioSeed: deriveSeed(worldSeed, 'audio'),
  };
}

export interface DoorSeedContext {
  houseSeed: string;
  journeySeed: string;
  /** Room the door is in. */
  roomId: string;
  doorId: string;
  /** How many times this journey has opened this door before (0 for the first time). */
  visit: number;
}

/**
 * Seeds for the world behind a door. The world seed depends on the journey, so the same
 * door leads somewhere different for each visitor and on each visit.
 */
export function deriveDoorSeeds(ctx: DoorSeedContext): SeedSet {
  const worldSeed = deriveSeed(ctx.journeySeed, `door:${ctx.doorId}:${ctx.visit}`);
  return SeedSet.parse({
    houseSeed: ctx.houseSeed,
    journeySeed: ctx.journeySeed,
    roomSeed: deriveSeed(ctx.houseSeed, `room:${ctx.roomId}`),
    worldSeed,
    ...subsystemSeeds(worldSeed),
  });
}

/** Seeds for reproducing a world from its world seed alone (developer route and tests). */
export function seedsFromWorldSeed(worldSeed: string): SeedSet {
  return SeedSet.parse({
    houseSeed: 'reproduction',
    journeySeed: 'reproduction',
    roomSeed: 'reproduction',
    worldSeed,
    ...subsystemSeeds(worldSeed),
  });
}
