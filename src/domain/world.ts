import { z } from 'zod';
import { Id } from './common';
import { RealityConfiguration } from './reality';

/** How a world is represented. Splat and hybrid worlds are later phases. */
export const WorldRepresentation = z.enum(['GEOMETRY_WORLD']);

/** A private world instance. It belongs to exactly one journey. */
export const World = z.strictObject({
  worldId: Id,
  journeyId: Id,
  representation: WorldRepresentation,
  reality: RealityConfiguration,
});
export type World = z.infer<typeof World>;
