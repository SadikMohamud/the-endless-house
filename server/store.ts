import type { SeedSet } from '../src/domain';
import type { JourneySnapshot } from '../src/journey/engine';

export interface SessionRecord {
  sessionId: string;
  visitorId: string;
  /** Seconds since the epoch. */
  expiresAt: number;
  revoked: boolean;
}

export interface JourneyRecord {
  journeyId: string;
  visitorId: string;
  snapshot: JourneySnapshot;
}

/** A private world: who owns it and the seeds that reproduce it. */
export interface WorldRecord {
  worldId: string;
  journeyId: string;
  visitorId: string;
  seeds: SeedSet;
}

/** Persistence for the House's authority data. Implementations must not share data across visitors. */
export interface Store {
  createSession(s: SessionRecord): Promise<void>;
  getSession(sessionId: string): Promise<SessionRecord | null>;
  revokeSession(sessionId: string): Promise<void>;
  saveJourney(j: JourneyRecord): Promise<void>;
  getJourney(journeyId: string): Promise<JourneyRecord | null>;
  saveWorld(w: WorldRecord): Promise<void>;
  getWorld(worldId: string): Promise<WorldRecord | null>;
}

/** In-memory store: tests and local development. Data is lost on restart. */
export class MemoryStore implements Store {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly journeys = new Map<string, JourneyRecord>();
  private readonly worlds = new Map<string, WorldRecord>();

  async createSession(s: SessionRecord) {
    this.sessions.set(s.sessionId, structuredClone(s));
  }
  async getSession(id: string) {
    const s = this.sessions.get(id);
    return s ? structuredClone(s) : null;
  }
  async revokeSession(id: string) {
    const s = this.sessions.get(id);
    if (s) s.revoked = true;
  }
  async saveJourney(j: JourneyRecord) {
    this.journeys.set(j.journeyId, structuredClone(j));
  }
  async getJourney(id: string) {
    const j = this.journeys.get(id);
    return j ? structuredClone(j) : null;
  }
  async saveWorld(w: WorldRecord) {
    this.worlds.set(w.worldId, structuredClone(w));
  }
  async getWorld(id: string) {
    const w = this.worlds.get(id);
    return w ? structuredClone(w) : null;
  }
}
