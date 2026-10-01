import { z } from 'zod';
import { Id } from './common';
import { Seed } from './seed';

/** Where the visitor is. A transition is its own location so a half-finished move is never ambiguous. */
export const JourneyLocation = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('HOUSE'), roomId: Id }),
  z.strictObject({ kind: z.literal('WORLD'), worldId: Id }),
  z.strictObject({
    kind: z.literal('TRANSITION'),
    doorId: Id,
    to: z.enum(['HOUSE', 'WORLD']),
  }),
]);
export type JourneyLocation = z.infer<typeof JourneyLocation>;

export const JourneyState = z.enum(['ACTIVE', 'ENDED']);
export type JourneyState = z.infer<typeof JourneyState>;

// Milestone 1 only has a visible, working way back.
export const ReturnState = z.enum(['AVAILABLE']);
export type ReturnState = z.infer<typeof ReturnState>;

/**
 * Something that happened on the journey. Ordered by `sequence`, not wall-clock time,
 * so a journey can be replayed exactly.
 */
export const JourneyEvent = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('JOURNEY_STARTED'), sequence: z.number().int().min(0) }),
  z.strictObject({
    type: z.literal('DOOR_OPENED'),
    sequence: z.number().int().min(0),
    doorId: Id,
  }),
  z.strictObject({
    type: z.literal('WORLD_ENTERED'),
    sequence: z.number().int().min(0),
    worldId: Id,
  }),
  z.strictObject({
    type: z.literal('WORLD_EXITED'),
    sequence: z.number().int().min(0),
    worldId: Id,
  }),
  z.strictObject({
    type: z.literal('HOUSE_ENTERED'),
    sequence: z.number().int().min(0),
    roomId: Id,
  }),
]);
export type JourneyEvent = z.infer<typeof JourneyEvent>;

export const Journey = z
  .strictObject({
    journeyId: Id,
    visitorId: Id,
    houseId: Id,
    /** The world the visitor is in or last generated. null before the first door. */
    worldId: Id.nullable(),
    seed: Seed,
    state: JourneyState,
    location: JourneyLocation,
    returnState: ReturnState,
    history: z.array(JourneyEvent),
  })
  .superRefine((j, ctx) => {
    j.history.forEach((e, i) => {
      if (e.sequence !== i)
        ctx.addIssue({ code: 'custom', message: `history event ${i} has sequence ${e.sequence}` });
    });
    if (j.location.kind === 'WORLD' && j.location.worldId !== j.worldId)
      ctx.addIssue({ code: 'custom', message: 'location world does not match journey world' });
  });
export type Journey = z.infer<typeof Journey>;
