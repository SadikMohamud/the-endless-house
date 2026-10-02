import { describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { SqliteStore } from '../server/sqlite-store';
import { MemoryStore, type Store } from '../server/store';
import { signToken } from '../server/tokens';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';

function harness(store: Store) {
  let clock = 1_800_000_000;
  const app = createApp({ store, secret: SECRET, sessionTtl: 3600, now: () => clock });
  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, text };
  };
  const visitor = async () => {
    const session = await call('POST', '/api/session');
    const token = session.body.token as string;
    const journey = await call('POST', '/api/journeys', token);
    const journeyId = journey.body.journey.journeyId as string;
    await call('POST', `/api/journeys/${journeyId}/rooms`, token, { roomId: 'door-room' });
    const opened = await call('POST', `/api/journeys/${journeyId}/doors/door-1/open`, token, {
      roomId: 'door-room',
    });
    const worldId = opened.body.worldId as string;
    await call('POST', `/api/journeys/${journeyId}/worlds/${worldId}/enter`, token);
    return { token, visitorId: session.body.visitorId as string, journeyId, worldId, opened };
  };
  return { app, call, visitor, advance: (s: number) => (clock += s) };
}

const stores: Array<[string, () => Store]> = [
  ['memory store', () => new MemoryStore()],
  ['SQLite store', () => new SqliteStore(':memory:')],
];

describe.each(stores)('House server (%s)', (_name, makeStore) => {
  describe('journeys through the server', () => {
    it('runs a full round trip with server-side rules', async () => {
      const { call, visitor } = harness(makeStore());
      const a = await visitor();
      expect(a.opened.status).toBe(200);
      expect(a.opened.body.seeds.worldSeed).toMatch(/^[0-9a-f]{32}$/);

      let r = await call('POST', `/api/journeys/${a.journeyId}/leave`, a.token, {
        doorId: 'return-frame',
      });
      expect(r.status).toBe(200);
      r = await call('POST', `/api/journeys/${a.journeyId}/house`, a.token, { roomId: 'corridor' });
      expect(r.body.journey.location).toEqual({ kind: 'HOUSE', roomId: 'corridor' });
      expect(r.body.journey.history).toHaveLength(6);
    });

    it('never sends the journey seed to the browser', async () => {
      const { call, visitor } = harness(makeStore());
      const a = await visitor();
      const r = await call('GET', `/api/journeys/${a.journeyId}`, a.token);
      expect(r.status).toBe(200);
      expect(r.body.journey.seed).toBeUndefined();
      expect('seed' in r.body.journey).toBe(false);
    });

    it('returns only a light colour as the door hint', async () => {
      const { call, visitor } = harness(makeStore());
      const a = await visitor();
      await call('POST', `/api/journeys/${a.journeyId}/leave`, a.token, { doorId: 'return-frame' });
      await call('POST', `/api/journeys/${a.journeyId}/house`, a.token, { roomId: 'door-room' });
      const r = await call(
        'GET',
        `/api/journeys/${a.journeyId}/doors/door-1/hint?roomId=door-room`,
        a.token,
      );
      expect(r.status).toBe(200);
      expect(Object.keys(r.body)).toEqual(['light']);
      expect(r.body.light).toMatch(/^#[0-9A-F]{6}$/i);
    });

    it('rejects illegal transitions with 409 and leaves the journey intact', async () => {
      const { call, visitor } = harness(makeStore());
      const a = await visitor();
      const before = await call('GET', `/api/journeys/${a.journeyId}`, a.token);
      const r = await call('POST', `/api/journeys/${a.journeyId}/house`, a.token, {
        roomId: 'corridor',
      });
      expect(r.status).toBe(409);
      const after = await call('GET', `/api/journeys/${a.journeyId}`, a.token);
      expect(after.body).toEqual(before.body);
    });

    it('rejects malformed and over-specified bodies', async () => {
      const { call, visitor } = harness(makeStore());
      const a = await visitor();
      for (const body of [{}, { roomId: 42 }, { roomId: 'corridor', visitorId: 'v-evil' }, 'x']) {
        const r = await call('POST', `/api/journeys/${a.journeyId}/rooms`, a.token, body);
        expect([400, 409]).toContain(r.status);
      }
    });
  });

  describe('AT-12: private-world isolation', () => {
    it('visitor A cannot read visitor B’s world, even with its real id', async () => {
      const { call, visitor } = harness(makeStore());
      const a = await visitor();
      const b = await visitor();
      const own = await call('GET', `/api/worlds/${a.worldId}`, a.token);
      expect(own.status).toBe(200);
      const stolen = await call('GET', `/api/worlds/${b.worldId}`, a.token);
      expect(stolen.status).toBe(404);
      expect(stolen.text).not.toContain(b.opened.body.seeds.worldSeed);
      expect(stolen.text).not.toContain(b.journeyId);
    });

    it('visitor A cannot read, drive or probe visitor B’s journey', async () => {
      const { call, visitor } = harness(makeStore());
      const a = await visitor();
      const b = await visitor();
      const attempts = [
        call('GET', `/api/journeys/${b.journeyId}`, a.token),
        call('POST', `/api/journeys/${b.journeyId}/leave`, a.token, { doorId: 'return-frame' }),
        call('POST', `/api/journeys/${b.journeyId}/rooms`, a.token, { roomId: 'corridor' }),
        call('POST', `/api/journeys/${b.journeyId}/worlds/${b.worldId}/enter`, a.token),
        call('GET', `/api/journeys/${b.journeyId}/doors/door-1/hint?roomId=door-room`, a.token),
      ];
      for (const r of await Promise.all(attempts)) {
        expect(r.status).toBe(404);
        expect(r.body).toEqual({ error: 'not found' });
      }
      // B's journey was not changed by any of it.
      const bNow = await call('GET', `/api/journeys/${b.journeyId}`, b.token);
      expect(bNow.body.journey.location).toEqual({ kind: 'WORLD', worldId: b.worldId });
    });

    it('a stranger’s id and a missing id look identical (no existence oracle)', async () => {
      const { call, visitor } = harness(makeStore());
      const a = await visitor();
      const b = await visitor();
      const real = await call('GET', `/api/worlds/${b.worldId}`, a.token);
      const guessed = await call('GET', '/api/worlds/w-00000000000000000000', a.token);
      expect(real.status).toBe(guessed.status);
      expect(real.body).toEqual(guessed.body);
    });

    it('cannot enter another visitor’s world through its own journey', async () => {
      const { call, visitor } = harness(makeStore());
      const a = await visitor();
      const b = await visitor();
      await call('POST', `/api/journeys/${a.journeyId}/leave`, a.token, { doorId: 'return-frame' });
      await call('POST', `/api/journeys/${a.journeyId}/house`, a.token, { roomId: 'door-room' });
      await call('POST', `/api/journeys/${a.journeyId}/doors/door-1/open`, a.token, {
        roomId: 'door-room',
      });
      const r = await call(
        'POST',
        `/api/journeys/${a.journeyId}/worlds/${b.worldId}/enter`,
        a.token,
      );
      expect(r.status).toBe(409);
    });

    it('rejects guessed, path-shaped and injection-shaped identifiers', async () => {
      const { call, visitor } = harness(makeStore());
      const a = await visitor();
      for (const id of [
        'w-00000000000000000000',
        '..%2F..%2Fapi%2Fsession',
        "w-1' OR '1'='1",
        'j-%00',
        'x'.repeat(200),
      ]) {
        expect((await call('GET', `/api/worlds/${id}`, a.token)).status).toBe(404);
        expect((await call('GET', `/api/journeys/${id}`, a.token)).status).toBe(404);
      }
    });
  });

  describe('AT-12: sessions and credentials', () => {
    it('requires a session for everything but creating one', async () => {
      const { call, visitor } = harness(makeStore());
      const a = await visitor();
      for (const [method, path] of [
        ['POST', '/api/journeys'],
        ['GET', `/api/journeys/${a.journeyId}`],
        ['GET', `/api/worlds/${a.worldId}`],
        ['DELETE', '/api/session'],
      ] as const) {
        expect((await call(method, path)).status).toBe(401);
      }
    });

    it('rejects tampered, forged and malformed tokens', async () => {
      const { call, visitor } = harness(makeStore());
      const a = await visitor();
      const b = await visitor();
      const [body, sig] = a.token.split('.') as [string, string];
      const swapped = `${b.token.split('.')[0]}.${sig}`; // B's claims with A's signature
      const forged = await signToken(
        { sid: 's-forged', vid: a.visitorId, exp: 9_999_999_999 },
        'a-different-secret-of-at-least-32-characters',
      );
      for (const token of [
        `${body}.${sig.slice(0, -2)}AA`,
        swapped,
        forged,
        'not-a-token',
        `${body}.`,
      ]) {
        expect((await call('GET', `/api/worlds/${a.worldId}`, token)).status).toBe(401);
      }
    });

    it('rejects a token whose claims point at another visitor’s session', async () => {
      const { call, visitor } = harness(makeStore());
      const a = await visitor();
      const b = await visitor();
      // Correctly signed, but claims B's visitor id on A's session id.
      const [aPayload] = a.token.split('.') as [string];
      const claims = JSON.parse(atob(aPayload.replace(/-/g, '+').replace(/_/g, '/')));
      const crossed = await signToken({ ...claims, vid: b.visitorId }, SECRET);
      expect((await call('GET', `/api/worlds/${b.worldId}`, crossed)).status).toBe(401);
    });

    it('rejects an expired session (stale credentials)', async () => {
      const { call, visitor, advance } = harness(makeStore());
      const a = await visitor();
      advance(3601);
      expect((await call('GET', `/api/journeys/${a.journeyId}`, a.token)).status).toBe(401);
    });

    it('rejects a replayed token after the session is revoked', async () => {
      const { call, visitor } = harness(makeStore());
      const a = await visitor();
      expect((await call('DELETE', '/api/session', a.token)).status).toBe(204);
      expect((await call('GET', `/api/journeys/${a.journeyId}`, a.token)).status).toBe(401);
      expect((await call('GET', `/api/worlds/${a.worldId}`, a.token)).status).toBe(401);
    });

    it('a new session for the same browser is a different visitor (no shared state)', async () => {
      const { call, visitor } = harness(makeStore());
      const a = await visitor();
      const fresh = await call('POST', '/api/session');
      expect(fresh.body.visitorId).not.toBe(a.visitorId);
      expect((await call('GET', `/api/worlds/${a.worldId}`, fresh.body.token)).status).toBe(404);
    });
  });
});

describe('server configuration', () => {
  it('refuses a short secret', () => {
    expect(() => createApp({ store: new MemoryStore(), secret: 'short' })).toThrow();
  });

  it('only allows configured browser origins', async () => {
    const app = createApp({
      store: new MemoryStore(),
      secret: SECRET,
      allowedOrigins: ['http://localhost:5173'],
    });
    const ok = await app.request('/api/health', { headers: { Origin: 'http://localhost:5173' } });
    const evil = await app.request('/api/health', { headers: { Origin: 'https://evil.example' } });
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(evil.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
