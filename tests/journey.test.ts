import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_HOUSE_DNA, Journey } from '../src/domain';
import { planWorld } from '../src/gen/planner';
import { buildDestination } from '../src/journey/destination';
import { JourneyEngine, JourneyError } from '../src/journey/engine';
import { crossedFrame } from '../src/world/frame-crossing';

const newJourney = (journeySeed = 'journey-seed-1') =>
  new JourneyEngine({
    journeyId: 'j-1',
    visitorId: 'v-1',
    houseId: 'house-1',
    houseSeed: 'house-seed-1',
    journeySeed,
    roomId: 'start-room',
  });

/** Walk to the door room, then one full trip: door → world → frame → House corridor. */
function roundTrip(j: JourneyEngine): string {
  j.moveToRoom('corridor');
  j.moveToRoom('door-room');
  const { worldId } = j.openDoor('door-1', 'door-room');
  j.enterWorld(worldId);
  j.leaveWorld('return-frame');
  j.enterHouse('corridor');
  return worldId;
}

describe('AT-08: transition integrity', () => {
  it('starts in the House with a valid journey', () => {
    const j = newJourney().journey;
    expect(Journey.safeParse(j).success).toBe(true);
    expect(j.location).toEqual({ kind: 'HOUSE', roomId: 'start-room' });
    expect(j.worldId).toBeNull();
  });

  it('records each step of House → world → House with valid references', () => {
    const j = newJourney();
    j.moveToRoom('door-room');

    const { worldId, seeds } = j.openDoor('door-1', 'door-room');
    expect(j.journey.location).toEqual({ kind: 'TRANSITION', doorId: 'door-1', to: 'WORLD' });
    expect(worldId).toMatch(/^w-[0-9a-f]{16}$/);
    expect(seeds.worldSeed.startsWith(worldId.slice(2))).toBe(true);

    j.enterWorld(worldId);
    expect(j.journey.location).toEqual({ kind: 'WORLD', worldId });
    expect(j.journey.worldId).toBe(worldId);

    j.leaveWorld('return-frame');
    expect(j.journey.location).toEqual({ kind: 'TRANSITION', doorId: 'return-frame', to: 'HOUSE' });
    expect(j.journey.worldId).toBe(worldId); // the journey still knows where it has been

    j.enterHouse('corridor');
    expect(j.journey.location).toEqual({ kind: 'HOUSE', roomId: 'corridor' });
    expect(j.journey.history.map((e) => e.type)).toEqual([
      'JOURNEY_STARTED',
      'HOUSE_ENTERED',
      'DOOR_OPENED',
      'WORLD_ENTERED',
      'WORLD_EXITED',
      'HOUSE_ENTERED',
    ]);
    expect(Journey.safeParse(j.journey).success).toBe(true);
  });

  it('stays valid over repeated round trips, with a new world each time', () => {
    const j = newJourney();
    const worlds = [roundTrip(j), roundTrip(j), roundTrip(j)];
    expect(new Set(worlds).size).toBe(3);
    expect(Journey.safeParse(j.journey).success).toBe(true);
    expect(j.journey.history).toHaveLength(2 + 3 * 4);
    expect(j.journey.location).toEqual({ kind: 'HOUSE', roomId: 'corridor' });
  });

  it('rejects out-of-order transitions without corrupting state', () => {
    const j = newJourney();
    const before = j.journey;
    expect(() => j.enterWorld('w-0000000000000000')).toThrow(JourneyError);
    expect(() => j.leaveWorld('return-frame')).toThrow(JourneyError);
    expect(() => j.enterHouse('corridor')).toThrow(JourneyError);
    // A door in another room cannot be opened from here.
    expect(() => j.openDoor('door-1', 'door-room')).toThrow(JourneyError);
    expect(j.journey).toEqual(before);

    j.moveToRoom('door-room');
    const { worldId } = j.openDoor('door-1', 'door-room');
    expect(() => j.openDoor('door-1', 'door-room')).toThrow(JourneyError);
    expect(() => j.enterWorld('w-ffffffffffffffff')).toThrow(JourneyError); // wrong world
    expect(() => j.moveToRoom('corridor')).toThrow(JourneyError);
    j.enterWorld(worldId);
    expect(j.journey.location).toEqual({ kind: 'WORLD', worldId });
  });

  it('falls back to the House if generation fails, and the next opening still works', () => {
    const j = newJourney();
    j.moveToRoom('door-room');
    j.openDoor('door-1', 'door-room');
    j.abortToHouse('door-room');
    expect(j.journey.location).toEqual({ kind: 'HOUSE', roomId: 'door-room' });
    expect(j.journey.worldId).toBeNull();
    const { worldId } = j.openDoor('door-1', 'door-room');
    j.enterWorld(worldId);
    expect(Journey.safeParse(j.journey).success).toBe(true);
  });

  it('room moves update the location without adding history', () => {
    const j = newJourney();
    j.moveToRoom('corridor');
    expect(j.journey.location).toEqual({ kind: 'HOUSE', roomId: 'corridor' });
    expect(j.journey.history).toHaveLength(2);
  });

  it('the same door leads somewhere different for another journey', () => {
    const a = newJourney('seed-a');
    const b = newJourney('seed-b');
    expect(a.peekDoor('door-1', 'door-room').worldSeed).not.toBe(
      b.peekDoor('door-1', 'door-room').worldSeed,
    );
  });

  it('peeking at a door changes nothing', () => {
    const j = newJourney();
    const before = j.journey;
    const peek = j.peekDoor('door-1', 'door-room');
    expect(j.journey).toEqual(before);
    j.moveToRoom('door-room');
    expect(j.openDoor('door-1', 'door-room').seeds).toEqual(peek);
  });
});

describe('AT-10: AI independence', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('plans and generates a world with no network and no AI configured', () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network is not available');
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('WebSocket', undefined);

    const j = newJourney();
    j.moveToRoom('door-room');
    const { seeds, worldId } = j.openDoor('door-1', 'door-room');
    const destination = buildDestination(seeds, { worldId, journeyId: 'j-1' }, DEFAULT_HOUSE_DNA);
    j.enterWorld(worldId);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(destination.forest.trees.length).toBeGreaterThanOrEqual(400);
    expect(j.journey.location).toEqual({ kind: 'WORLD', worldId });
  });

  it('a failing planner is reported, not hidden, so the caller can fall back', () => {
    const j = newJourney();
    j.moveToRoom('door-room');
    const { seeds, worldId } = j.openDoor('door-1', 'door-room');
    const broken = () => {
      throw new Error('planner unavailable');
    };
    expect(() =>
      buildDestination(seeds, { worldId, journeyId: 'j-1' }, DEFAULT_HOUSE_DNA, broken),
    ).toThrow('planner unavailable');
  });

  it('rejects a plan that does not match the seed it was asked for', () => {
    const j = newJourney();
    j.moveToRoom('door-room');
    const { seeds, worldId } = j.openDoor('door-1', 'door-room');
    const wrongSeed = () => ({ ...planWorld(seeds), seed: 'someone-elses-world' });
    expect(() =>
      buildDestination(seeds, { worldId, journeyId: 'j-1' }, DEFAULT_HOUSE_DNA, wrongSeed),
    ).toThrow();
  });
});

describe('frame crossing', () => {
  const frame = { x: 10, y: 2, z: 5, facing: { x: 0, z: 1 }, width: 1, height: 2.4 };
  const at = (x: number, z: number, y = 2) => ({ x, y, z });

  it('detects walking through the opening, in either direction', () => {
    expect(crossedFrame(at(10, 5.2), at(10, 4.9), frame)).toBe(true);
    expect(crossedFrame(at(10.3, 4.9), at(10.3, 5.1), frame)).toBe(true);
  });

  it('ignores passing beside the frame, staying on one side, or going over it', () => {
    expect(crossedFrame(at(11, 5.2), at(11, 4.8), frame)).toBe(false);
    expect(crossedFrame(at(10, 6), at(10, 5.5), frame)).toBe(false);
    expect(crossedFrame(at(10, 5.2, 5), at(10, 4.8, 5), frame)).toBe(false);
  });
});
