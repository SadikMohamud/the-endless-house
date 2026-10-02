import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app';
import { MemoryStore } from '../server/store';
import { RemoteJourneyError, RemoteJourneyService } from '../src/journey/service';

const API = 'http://house.test';

/** Routes the browser client's fetch calls into the real server app, in-process. */
function serveInProcess() {
  const app = createApp({
    store: new MemoryStore(),
    secret: 'test-secret-that-is-at-least-32-characters-long',
  });
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = url.replace(API, '');
    calls.push(`${init?.method ?? 'GET'} ${path.split('?')[0]}`);
    return app.request(path, init);
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('RemoteJourneyService against the real server', () => {
  it('runs a full round trip, mirroring the server’s journey', async () => {
    serveInProcess();
    const service = await RemoteJourneyService.connect(API);
    expect(service.journey.location).toEqual({ kind: 'HOUSE', roomId: 'start-room' });
    expect('seed' in service.journey).toBe(false);

    await service.moveToRoom('door-room');
    expect(await service.doorHint('door-1', 'door-room')).toMatch(/^#[0-9A-F]{6}$/i);
    const { worldId, seeds } = await service.openDoor('door-1', 'door-room');
    expect(seeds.worldSeed).toMatch(/^[0-9a-f]{32}$/);
    await service.enterWorld(worldId);
    expect(service.journey.location).toEqual({ kind: 'WORLD', worldId });
    await service.leaveWorld('return-frame');
    await service.enterHouse('corridor');
    expect(service.journey.location).toEqual({ kind: 'HOUSE', roomId: 'corridor' });
    expect(service.journey.history).toHaveLength(6);
  });

  it('keeps calls in the order they were made', async () => {
    const calls = serveInProcess();
    const service = await RemoteJourneyService.connect(API);
    // Fired without awaiting each one, as room changes are in the browser.
    const room = service.moveToRoom('door-room');
    const door = service.openDoor('door-1', 'door-room');
    await Promise.all([room, door]);
    const order = calls.filter((c) => c.includes('/journeys/j-'));
    expect(order[0]).toMatch(/\/rooms$/);
    expect(order[1]).toMatch(/\/doors\/door-1\/open$/);
  });

  it('surfaces server refusals as errors the experience can handle', async () => {
    serveInProcess();
    const service = await RemoteJourneyService.connect(API);
    // The door is in another room: the server refuses.
    await expect(service.openDoor('door-1', 'door-room')).rejects.toBeInstanceOf(
      RemoteJourneyError,
    );
    // A refused call does not block later ones.
    await service.moveToRoom('door-room');
    await expect(service.openDoor('door-1', 'door-room')).resolves.toBeTruthy();
  });

  it('rejects connecting when the server is unreachable', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    await expect(RemoteJourneyService.connect(API)).rejects.toThrow('fetch failed');
  });

  it('rejects seeds that fail validation instead of generating from them', async () => {
    serveInProcess();
    const service = await RemoteJourneyService.connect(API);
    await service.moveToRoom('door-room');
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const res = await realFetch(url, init);
      if (!url.includes('/open')) return res;
      const body = await res.json();
      body.seeds = { ...body.seeds, worldSeed: '' };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    await expect(service.openDoor('door-1', 'door-room')).rejects.toThrow();
  });
});
