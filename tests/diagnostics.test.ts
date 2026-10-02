import { describe, expect, it } from 'vitest';
import { JourneyEngine } from '../src/journey/engine';
import { FrameStats } from '../src/runtime/frame-stats';
import {
  formatDiagnostics,
  transitionGraph,
  type DiagnosticsSnapshot,
} from '../src/ui/diagnostics';

const snapshot = (overrides: Partial<DiagnosticsSnapshot> = {}): DiagnosticsSnapshot => ({
  renderer: 'webgpu',
  journeyId: 'j-1',
  location: 'world',
  roomId: null,
  worldId: 'w-0123456789abcdef',
  seed: '0123456789abcdef0123456789abcdef',
  generatorVersion: 'forest@1.0.0',
  visualProfile: 'NATURAL',
  physicsProfile: 'LOW_GRAVITY',
  movementProfile: 'STANDARD',
  gravity: -2.5,
  loadedAssets: { geometries: 14, textures: 3, drawCalls: 9, triangles: 120000 },
  fps: 59.9,
  frameMs: 16.7,
  frameP95Ms: 17.2,
  cpuMs: 1.23,
  jsHeapMb: null,
  online: false,
  transitionGraph: 'start-room → door-1 → w-0123456789abcdef',
  ...overrides,
});

describe('diagnostics overlay', () => {
  it('shows every field the spec asks for', () => {
    const text = formatDiagnostics(snapshot());
    for (const expected of [
      'journey    j-1',
      'w-0123456789abcdef',
      '0123456789abcdef0123456789abcdef',
      'forest@1.0.0',
      'NATURAL',
      'LOW_GRAVITY (g -2.50 m/s²)',
      'STANDARD',
      'fps        60',
      '14 geometries',
      '9 calls',
      'offline (not required)',
      'n/a',
      'start-room → door-1',
    ]) {
      expect(text).toContain(expected);
    }
  });

  it('builds the transition graph from the journey history', () => {
    const j = new JourneyEngine({
      journeyId: 'j',
      visitorId: 'v',
      houseId: 'h',
      houseSeed: 'hs',
      journeySeed: 'js',
      roomId: 'start-room',
    });
    j.moveToRoom('door-room');
    const { worldId } = j.openDoor('door-1', 'door-room');
    j.enterWorld(worldId);
    j.leaveWorld('return-frame');
    j.enterHouse('corridor');
    expect(transitionGraph(j.journey)).toBe(`start-room → door-1 → ${worldId} → corridor`);
    expect(transitionGraph(null)).toBe('(no journey)');
  });

  it('elides long paths', () => {
    const j = new JourneyEngine({
      journeyId: 'j',
      visitorId: 'v',
      houseId: 'h',
      houseSeed: 'hs',
      journeySeed: 'js',
      roomId: 'door-room',
    });
    for (let i = 0; i < 5; i++) {
      const { worldId } = j.openDoor('door-1', 'door-room');
      j.enterWorld(worldId);
      j.leaveWorld('return-frame');
      j.enterHouse('door-room');
    }
    const graph = transitionGraph(j.journey, 4);
    expect(graph.startsWith('… →')).toBe(true);
    expect(graph.split(' → ')).toHaveLength(5);
  });
});

describe('frame statistics', () => {
  it('reports fps, mean, p95 and CPU time over a rolling window', () => {
    const stats = new FrameStats(100);
    for (let i = 0; i < 95; i++) stats.record(16, 2);
    for (let i = 0; i < 5; i++) stats.record(50, 10);
    expect(stats.samples).toBe(100);
    expect(stats.frameMs).toBeCloseTo(17.7, 1);
    expect(stats.fps).toBeCloseTo(1000 / 17.7, 0);
    expect(stats.frameP95Ms).toBe(50);
    expect(stats.cpuMs).toBeCloseTo(2.4, 5);
  });

  it('keeps only the newest samples', () => {
    const stats = new FrameStats(10);
    for (let i = 0; i < 10; i++) stats.record(100, 0);
    for (let i = 0; i < 10; i++) stats.record(10, 0);
    expect(stats.frameMs).toBe(10);
    stats.reset();
    expect(stats.samples).toBe(0);
    expect(stats.fps).toBe(0);
  });
});
