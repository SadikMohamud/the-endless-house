import { DatabaseSync } from 'node:sqlite';
import { SeedSet } from '../src/domain';
import { JourneySnapshot } from '../src/journey/engine';
import type { JourneyRecord, SessionRecord, Store, WorldRecord } from './store';

/**
 * SQLite persistence using Node's built-in driver. Every query is parameterised, and stored
 * JSON is re-validated on the way out so a corrupted row cannot become a malformed journey.
 */
export class SqliteStore implements Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        visitor_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS journeys (
        journey_id TEXT PRIMARY KEY,
        visitor_id TEXT NOT NULL,
        snapshot TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS worlds (
        world_id TEXT PRIMARY KEY,
        journey_id TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        seeds TEXT NOT NULL
      );
    `);
  }

  async createSession(s: SessionRecord) {
    this.db
      .prepare(
        'INSERT INTO sessions (session_id, visitor_id, expires_at, revoked) VALUES (?, ?, ?, ?)',
      )
      .run(s.sessionId, s.visitorId, s.expiresAt, s.revoked ? 1 : 0);
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const row = this.db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(id) as
      { session_id: string; visitor_id: string; expires_at: number; revoked: number } | undefined;
    return row
      ? {
          sessionId: row.session_id,
          visitorId: row.visitor_id,
          expiresAt: row.expires_at,
          revoked: row.revoked === 1,
        }
      : null;
  }

  async revokeSession(id: string) {
    this.db.prepare('UPDATE sessions SET revoked = 1 WHERE session_id = ?').run(id);
  }

  async saveJourney(j: JourneyRecord) {
    this.db
      .prepare(
        `INSERT INTO journeys (journey_id, visitor_id, snapshot) VALUES (?, ?, ?)
         ON CONFLICT(journey_id) DO UPDATE SET snapshot = excluded.snapshot
         WHERE journeys.visitor_id = excluded.visitor_id`,
      )
      .run(j.journeyId, j.visitorId, JSON.stringify(j.snapshot));
  }

  async getJourney(id: string): Promise<JourneyRecord | null> {
    const row = this.db.prepare('SELECT * FROM journeys WHERE journey_id = ?').get(id) as
      { journey_id: string; visitor_id: string; snapshot: string } | undefined;
    return row
      ? {
          journeyId: row.journey_id,
          visitorId: row.visitor_id,
          snapshot: JourneySnapshot.parse(JSON.parse(row.snapshot)),
        }
      : null;
  }

  async saveWorld(w: WorldRecord) {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO worlds (world_id, journey_id, visitor_id, seeds) VALUES (?, ?, ?, ?)',
      )
      .run(w.worldId, w.journeyId, w.visitorId, JSON.stringify(w.seeds));
  }

  async getWorld(id: string): Promise<WorldRecord | null> {
    const row = this.db.prepare('SELECT * FROM worlds WHERE world_id = ?').get(id) as
      { world_id: string; journey_id: string; visitor_id: string; seeds: string } | undefined;
    return row
      ? {
          worldId: row.world_id,
          journeyId: row.journey_id,
          visitorId: row.visitor_id,
          seeds: SeedSet.parse(JSON.parse(row.seeds)),
        }
      : null;
  }

  close(): void {
    this.db.close();
  }
}
