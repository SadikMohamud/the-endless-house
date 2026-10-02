import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { Id } from '../src/domain';
import { planWorld } from '../src/gen/planner';
import { JourneyEngine, JourneyError } from '../src/journey/engine';
import type { Store } from './store';
import { signToken, verifyToken } from './tokens';

export interface AppConfig {
  store: Store;
  /** HMAC secret for session tokens. Never sent to clients. */
  secret: string;
  /** Seconds a session lasts. */
  sessionTtl?: number;
  /** Origins allowed to call the API from a browser. */
  allowedOrigins?: string[];
  /** Injectable clock (seconds since the epoch) for tests. */
  now?: () => number;
  /** Injectable randomness for ids and seeds. */
  randomHex?: (bytes: number) => string;
}

const HOUSE_ID = 'house-1';
const HOUSE_SEED = 'house-seed-1';
const START_ROOM = 'start-room';

const defaultRandomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

type Env = { Variables: { visitorId: string; sessionId: string } };

const RoomBody = z.strictObject({ roomId: Id });
const DoorBody = z.strictObject({ doorId: Id });

/**
 * The House's authority. Owns sessions, journeys and private worlds. Every journey and world
 * route checks ownership; anything not owned by the caller is reported as not found, exactly
 * like something that does not exist, so ids cannot be probed.
 */
export function createApp(config: AppConfig) {
  const { store, secret } = config;
  const ttl = config.sessionTtl ?? 60 * 60 * 24 * 7;
  const now = config.now ?? (() => Math.floor(Date.now() / 1000));
  const randomHex = config.randomHex ?? defaultRandomHex;
  if (secret.length < 32) throw new Error('session secret must be at least 32 characters');

  const app = new Hono<Env>();
  app.use(
    '/api/*',
    cors({
      origin: config.allowedOrigins ?? [],
      allowMethods: ['GET', 'POST', 'DELETE'],
      allowHeaders: ['Authorization', 'Content-Type'],
    }),
  );

  const unauthorised = (c: Context) => c.json({ error: 'unauthorised' }, 401);
  const notFound = (c: Context) => c.json({ error: 'not found' }, 404);

  app.get('/api/health', (c) => c.json({ ok: true }));

  // A new anonymous visitor session. No account, no personal data.
  app.post('/api/session', async (c) => {
    const sessionId = `s-${randomHex(16)}`;
    const visitorId = `v-${randomHex(16)}`;
    const expiresAt = now() + ttl;
    await store.createSession({ sessionId, visitorId, expiresAt, revoked: false });
    const token = await signToken({ sid: sessionId, vid: visitorId, exp: expiresAt }, secret);
    return c.json({ token, visitorId, expiresAt }, 201);
  });

  // Everything below requires a valid, unrevoked, unexpired session.
  app.use('/api/*', async (c, next) => {
    if (c.req.method === 'OPTIONS') return next();
    const header = c.req.header('Authorization') ?? '';
    const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(header);
    if (!match) return unauthorised(c);
    const payload = await verifyToken(match[1]!, secret, now());
    if (!payload) return unauthorised(c);
    const session = await store.getSession(payload.sid);
    if (
      !session ||
      session.revoked ||
      session.visitorId !== payload.vid ||
      session.expiresAt <= now()
    ) {
      return unauthorised(c);
    }
    c.set('visitorId', session.visitorId);
    c.set('sessionId', session.sessionId);
    return next();
  });

  app.delete('/api/session', async (c) => {
    await store.revokeSession(c.get('sessionId'));
    return c.body(null, 204);
  });

  app.post('/api/journeys', async (c) => {
    const visitorId = c.get('visitorId');
    const engine = new JourneyEngine({
      journeyId: `j-${randomHex(16)}`,
      visitorId,
      houseId: HOUSE_ID,
      houseSeed: HOUSE_SEED,
      journeySeed: randomHex(16),
      roomId: START_ROOM,
    });
    await save(engine);
    return c.json({ journey: engine.publicJourney }, 201);
  });

  /** Loads a journey only if the caller owns it. */
  async function load(c: Context<Env>): Promise<JourneyEngine | null> {
    const id = Id.safeParse(c.req.param('journeyId'));
    if (!id.success) return null;
    const record = await store.getJourney(id.data);
    if (!record || record.visitorId !== c.get('visitorId')) return null;
    return JourneyEngine.restore(record.snapshot);
  }

  async function save(engine: JourneyEngine): Promise<void> {
    const s = engine.snapshot();
    await store.saveJourney({
      journeyId: s.journey.journeyId,
      visitorId: s.journey.visitorId,
      snapshot: s,
    });
  }

  /** Runs one journey transition: ownership, input validation, the rule, then persistence. */
  function transition<T extends z.ZodType>(
    schema: T | null,
    apply: (engine: JourneyEngine, body: z.infer<T>, c: Context<Env>) => Promise<object> | object,
  ) {
    return async (c: Context<Env>) => {
      const engine = await load(c);
      if (!engine) return notFound(c);
      let body: z.infer<T> = undefined as z.infer<T>;
      if (schema) {
        const parsed = schema.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) return c.json({ error: 'invalid request' }, 400);
        body = parsed.data;
      }
      let result: object;
      try {
        result = await apply(engine, body, c);
      } catch (err) {
        if (err instanceof JourneyError) return c.json({ error: err.message }, 409);
        throw err;
      }
      await save(engine);
      return c.json({ ...result, journey: engine.publicJourney });
    };
  }

  app.get('/api/journeys/:journeyId', async (c) => {
    const engine = await load(c);
    return engine ? c.json({ journey: engine.publicJourney }) : notFound(c);
  });

  // The light under a door hints at its destination: only a colour leaves the server.
  app.get('/api/journeys/:journeyId/doors/:doorId/hint', async (c) => {
    const engine = await load(c);
    const doorId = Id.safeParse(c.req.param('doorId'));
    const roomId = Id.safeParse(c.req.query('roomId'));
    if (!engine) return notFound(c);
    if (!doorId.success || !roomId.success) return c.json({ error: 'invalid request' }, 400);
    const plan = planWorld(engine.peekDoor(doorId.data, roomId.data));
    return c.json({ light: plan.lightingProfile.sunColour });
  });

  app.post(
    '/api/journeys/:journeyId/rooms',
    transition(RoomBody, (engine, body) => {
      engine.moveToRoom(body.roomId);
      return {};
    }),
  );

  app.post(
    '/api/journeys/:journeyId/doors/:doorId/open',
    transition(RoomBody, async (engine, body, c) => {
      const doorId = Id.safeParse(c.req.param('doorId'));
      if (!doorId.success) throw new JourneyError('invalid door');
      const { seeds, worldId } = engine.openDoor(doorId.data, body.roomId);
      const journey = engine.journey;
      await store.saveWorld({
        worldId,
        journeyId: journey.journeyId,
        visitorId: journey.visitorId,
        seeds,
      });
      return { worldId, seeds };
    }),
  );

  app.post(
    '/api/journeys/:journeyId/worlds/:worldId/enter',
    transition(null, (engine, _body, c) => {
      const worldId = Id.safeParse(c.req.param('worldId'));
      if (!worldId.success) throw new JourneyError('invalid world');
      engine.enterWorld(worldId.data);
      return {};
    }),
  );

  app.post(
    '/api/journeys/:journeyId/abort',
    transition(RoomBody, (engine, body) => {
      engine.abortToHouse(body.roomId);
      return {};
    }),
  );

  app.post(
    '/api/journeys/:journeyId/leave',
    transition(DoorBody, (engine, body) => {
      engine.leaveWorld(body.doorId);
      return {};
    }),
  );

  app.post(
    '/api/journeys/:journeyId/house',
    transition(RoomBody, (engine, body) => {
      engine.enterHouse(body.roomId);
      return {};
    }),
  );

  // A private world's seeds: only ever to its owner.
  app.get('/api/worlds/:worldId', async (c) => {
    const id = Id.safeParse(c.req.param('worldId'));
    if (!id.success) return notFound(c);
    const world = await store.getWorld(id.data);
    if (!world || world.visitorId !== c.get('visitorId')) return notFound(c);
    return c.json({ worldId: world.worldId, journeyId: world.journeyId, seeds: world.seeds });
  });

  app.notFound((c) => notFound(c));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'internal error' }, 500);
  });

  return app;
}
