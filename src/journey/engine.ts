import { z } from 'zod';
import { Id, Journey, Seed, type JourneyEvent, type SeedSet } from '../domain';
import { deriveSeed } from '../gen/rng';
import { deriveDoorSeeds } from '../gen/seeds';

export class JourneyError extends Error {}

/** Everything needed to resume a journey later (server storage). Contains private seeds. */
export const JourneySnapshot = z.strictObject({
  journey: Journey,
  houseSeed: Seed,
  doorVisits: z.record(Id, z.number().int().min(0)),
  pendingWorldId: Id.nullable(),
});
export type JourneySnapshot = z.infer<typeof JourneySnapshot>;

/** A journey as it may be shown to its owner's browser: without the journey seed. */
export type PublicJourney = Omit<Journey, 'seed'>;

export interface JourneyStart {
  journeyId: string;
  visitorId: string;
  houseId: string;
  houseSeed: string;
  journeySeed: string;
  /** Room the visitor starts in. */
  roomId: string;
}

/** Event without its sequence number; the engine assigns those. */
type NewEvent = JourneyEvent extends infer E
  ? E extends JourneyEvent
    ? Omit<E, 'sequence'>
    : never
  : never;

/**
 * The journey state machine. Owns the Journey record and validates it after every change.
 * Allowed path: HOUSE → TRANSITION(to WORLD) → WORLD → TRANSITION(to HOUSE) → HOUSE.
 * An illegal call throws and leaves the state untouched.
 */
export class JourneyEngine {
  private state: Journey;
  private readonly houseSeed: string;
  private readonly doorVisits = new Map<string, number>();
  private pendingWorldId: string | null = null;

  constructor(start: JourneyStart) {
    this.houseSeed = start.houseSeed;
    this.state = Journey.parse({
      journeyId: start.journeyId,
      visitorId: start.visitorId,
      houseId: start.houseId,
      worldId: null,
      seed: start.journeySeed,
      state: 'ACTIVE',
      location: { kind: 'HOUSE', roomId: start.roomId },
      returnState: 'AVAILABLE',
      history: [
        { type: 'JOURNEY_STARTED', sequence: 0 },
        { type: 'HOUSE_ENTERED', sequence: 1, roomId: start.roomId },
      ],
    });
  }

  /** Rebuilds an engine from a stored snapshot, validating it first. */
  static restore(snapshot: JourneySnapshot): JourneyEngine {
    const s = JourneySnapshot.parse(snapshot);
    const engine = new JourneyEngine({
      journeyId: s.journey.journeyId,
      visitorId: s.journey.visitorId,
      houseId: s.journey.houseId,
      houseSeed: s.houseSeed,
      journeySeed: s.journey.seed,
      roomId: 'start-room',
    });
    engine.state = s.journey;
    for (const [door, visits] of Object.entries(s.doorVisits)) engine.doorVisits.set(door, visits);
    engine.pendingWorldId = s.pendingWorldId;
    return engine;
  }

  /** A read-only copy, including the journey seed. Never send this to another party. */
  get journey(): Readonly<Journey> {
    return structuredClone(this.state);
  }

  /** The journey without its seed, safe to return to the owning visitor. */
  get publicJourney(): PublicJourney {
    const { seed: _seed, ...rest } = structuredClone(this.state);
    void _seed;
    return rest;
  }

  snapshot(): JourneySnapshot {
    return {
      journey: structuredClone(this.state),
      houseSeed: this.houseSeed,
      doorVisits: Object.fromEntries(this.doorVisits),
      pendingWorldId: this.pendingWorldId,
    };
  }

  /** Seeds the door would lead to if opened now. Changes nothing. */
  peekDoor(doorId: string, roomId: string): SeedSet {
    return deriveDoorSeeds({
      houseSeed: this.houseSeed,
      journeySeed: this.state.seed,
      roomId,
      doorId,
      visit: this.doorVisits.get(doorId) ?? 0,
    });
  }

  /**
   * The visitor walked into another House room. Updates the current location only: moving
   * between rooms is not a journey event, so history is unchanged.
   */
  moveToRoom(roomId: string): void {
    const loc = this.state.location;
    if (loc.kind !== 'HOUSE') throw new JourneyError(`cannot change room from ${loc.kind}`);
    if (loc.roomId === roomId) return;
    this.state = Journey.parse({ ...this.state, location: { kind: 'HOUSE', roomId } });
  }

  /** The visitor opens a House door. Returns the destination's seeds and world id. */
  openDoor(doorId: string, roomId: string): { seeds: SeedSet; worldId: string } {
    const loc = this.state.location;
    if (loc.kind !== 'HOUSE') throw new JourneyError(`cannot open a House door from ${loc.kind}`);
    if (loc.roomId !== roomId) throw new JourneyError(`door ${doorId} is not in ${loc.roomId}`);
    const seeds = this.peekDoor(doorId, roomId);
    // A one-way hash: knowing a world id must not reveal any part of its seed.
    const worldId = `w-${deriveSeed(seeds.worldSeed, 'world-id').slice(0, 20)}`;
    this.commit(
      { location: { kind: 'TRANSITION', doorId, to: 'WORLD' } },
      { type: 'DOOR_OPENED', doorId },
    );
    this.doorVisits.set(doorId, (this.doorVisits.get(doorId) ?? 0) + 1);
    this.pendingWorldId = worldId;
    return { seeds, worldId };
  }

  /** The destination is ready and the visitor arrives in it. */
  enterWorld(worldId: string): void {
    const loc = this.state.location;
    if (loc.kind !== 'TRANSITION' || loc.to !== 'WORLD')
      throw new JourneyError('not travelling to a world');
    if (worldId !== this.pendingWorldId) throw new JourneyError(`unexpected world ${worldId}`);
    this.pendingWorldId = null;
    this.commit(
      { location: { kind: 'WORLD', worldId }, worldId },
      { type: 'WORLD_ENTERED', worldId },
    );
  }

  /** Generation failed or was interrupted: the visitor stays in the House. */
  abortToHouse(roomId: string): void {
    const loc = this.state.location;
    if (loc.kind !== 'TRANSITION' || loc.to !== 'WORLD')
      throw new JourneyError('no world transition to abort');
    this.pendingWorldId = null;
    this.commit({ location: { kind: 'HOUSE', roomId } }, { type: 'HOUSE_ENTERED', roomId });
  }

  /** The visitor passes through a way out of the world. */
  leaveWorld(doorId: string): void {
    const loc = this.state.location;
    if (loc.kind !== 'WORLD') throw new JourneyError(`cannot leave a world from ${loc.kind}`);
    this.commit(
      { location: { kind: 'TRANSITION', doorId, to: 'HOUSE' } },
      { type: 'WORLD_EXITED', worldId: loc.worldId },
    );
  }

  /** The visitor arrives back in the House. */
  enterHouse(roomId: string): void {
    const loc = this.state.location;
    if (loc.kind !== 'TRANSITION' || loc.to !== 'HOUSE')
      throw new JourneyError('not travelling to the House');
    this.commit({ location: { kind: 'HOUSE', roomId } }, { type: 'HOUSE_ENTERED', roomId });
  }

  /** Applies a change only if the resulting journey is valid. */
  private commit(change: Partial<Journey>, event: NewEvent): void {
    const next = Journey.parse({
      ...this.state,
      ...change,
      history: [...this.state.history, { ...event, sequence: this.state.history.length }],
    });
    this.state = next;
  }
}
