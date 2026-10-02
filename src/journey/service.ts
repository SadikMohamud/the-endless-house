import { SeedSet } from '../domain';
import { JourneyEngine, type PublicJourney } from './engine';
import type { WorldPlanner } from './destination';

/**
 * Where journey authority lives. Local: in this browser (offline, single visitor). Remote: on the
 * House server, which owns journeys and private worlds; the browser only mirrors its answers.
 */
export interface JourneyService {
  readonly mode: 'local' | 'remote';
  /** Latest known state, without the journey seed. */
  readonly journey: PublicJourney;
  /** Colour of the light under a door: a hint of where it leads. */
  doorHint(doorId: string, roomId: string): Promise<string>;
  moveToRoom(roomId: string): Promise<void>;
  openDoor(doorId: string, roomId: string): Promise<{ seeds: SeedSet; worldId: string }>;
  enterWorld(worldId: string): Promise<void>;
  abortToHouse(roomId: string): Promise<void>;
  leaveWorld(doorId: string): Promise<void>;
  enterHouse(roomId: string): Promise<void>;
}

export class LocalJourneyService implements JourneyService {
  readonly mode = 'local';

  constructor(
    readonly engine: JourneyEngine,
    private readonly planner: WorldPlanner,
  ) {}

  get journey() {
    return this.engine.publicJourney;
  }
  async doorHint(doorId: string, roomId: string) {
    return this.planner(this.engine.peekDoor(doorId, roomId)).lightingProfile.sunColour;
  }
  async moveToRoom(roomId: string) {
    this.engine.moveToRoom(roomId);
  }
  async openDoor(doorId: string, roomId: string) {
    return this.engine.openDoor(doorId, roomId);
  }
  async enterWorld(worldId: string) {
    this.engine.enterWorld(worldId);
  }
  async abortToHouse(roomId: string) {
    this.engine.abortToHouse(roomId);
  }
  async leaveWorld(doorId: string) {
    this.engine.leaveWorld(doorId);
  }
  async enterHouse(roomId: string) {
    this.engine.enterHouse(roomId);
  }
}

export class RemoteJourneyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Talks to the House server. Calls are queued so they reach the server in the order the visitor
 * made them (a room change cannot overtake a door opening).
 */
export class RemoteJourneyService implements JourneyService {
  readonly mode = 'remote';
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly api: string,
    private readonly token: string,
    private state: PublicJourney,
  ) {}

  /** Opens a session and a journey. Rejects if the server is unreachable within `timeoutMs`. */
  static async connect(api: string, timeoutMs = 3000): Promise<RemoteJourneyService> {
    const base = api.replace(/\/+$/, '');
    const session = await request(base, 'POST', '/api/session', null, undefined, timeoutMs);
    const token = (session as { token: string }).token;
    const created = await request(base, 'POST', '/api/journeys', token, undefined, timeoutMs);
    return new RemoteJourneyService(base, token, (created as { journey: PublicJourney }).journey);
  }

  get journey() {
    return structuredClone(this.state);
  }

  async doorHint(doorId: string, roomId: string) {
    const r = await this.call(
      'GET',
      `/doors/${encodeURIComponent(doorId)}/hint?roomId=${encodeURIComponent(roomId)}`,
    );
    return (r as { light: string }).light;
  }
  async moveToRoom(roomId: string) {
    await this.call('POST', '/rooms', { roomId });
  }
  async openDoor(doorId: string, roomId: string) {
    const r = (await this.call('POST', `/doors/${encodeURIComponent(doorId)}/open`, {
      roomId,
    })) as { worldId: string; seeds: unknown };
    // Validate what the server sent before it drives generation.
    return { worldId: r.worldId, seeds: SeedSet.parse(r.seeds) };
  }
  async enterWorld(worldId: string) {
    await this.call('POST', `/worlds/${encodeURIComponent(worldId)}/enter`);
  }
  async abortToHouse(roomId: string) {
    await this.call('POST', '/abort', { roomId });
  }
  async leaveWorld(doorId: string) {
    await this.call('POST', '/leave', { doorId });
  }
  async enterHouse(roomId: string) {
    await this.call('POST', '/house', { roomId });
  }

  private call(method: 'GET' | 'POST', path: string, body?: object): Promise<unknown> {
    const run = async () => {
      const r = await request(
        this.api,
        method,
        `/api/journeys/${encodeURIComponent(this.state.journeyId)}${path}`,
        this.token,
        body,
      );
      const journey = (r as { journey?: PublicJourney }).journey;
      if (journey) this.state = journey;
      return r;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

async function request(
  base: string,
  method: string,
  path: string,
  token: string | null,
  body?: object,
  timeoutMs = 8000,
): Promise<unknown> {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new RemoteJourneyError(res.status, data.error ?? `HTTP ${res.status}`);
  return data;
}
