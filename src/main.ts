import { DEFAULT_HOUSE_DNA, VisualProfileId } from './domain';
import { planWorld } from './gen/planner';
import { seedsFromWorldSeed } from './gen/seeds';
import { buildDestination } from './journey/destination';
import { JourneyEngine, type PublicJourney } from './journey/engine';
import { Experience } from './journey/experience';
import { LocalJourneyService, RemoteJourneyService, type JourneyService } from './journey/service';
import { loadPhysics } from './platform/physics';
import { Engine } from './runtime/engine';
import { Input } from './runtime/input';
import { ForestStage } from './stages/forest-stage';
import { HouseStage } from './stages/house-stage';
import { DiagnosticsOverlay, transitionGraph, type DiagnosticsSnapshot } from './ui/diagnostics';

const HOUSE_ID = 'house-1';
const HOUSE_SEED = 'house-seed-1';

/** Read-only runtime state for automated checks. Phase 8 adds the visible diagnostics overlay. */
interface HouseState {
  status: 'starting' | 'ready' | 'error';
  renderer?: string;
  physics?: string;
  error?: string;
  frames: () => number;
  feet: () => { x: number; y: number; z: number } | null;
  locked: () => boolean;
  inReach: () => boolean;
  doorState: () => string | null;
  phase: () => string;
  journey: () => PublicJourney | null;
  gpuMemory: () => { geometries: number; textures: number } | null;
  diagnostics: () => DiagnosticsSnapshot | null;
  diagnosticsVisible: () => boolean;
  world: () => {
    seed: string;
    generatorVersion: string;
    physicsProfile: string;
    lighting: string;
    trees: number;
    clearings: number;
  } | null;
}

declare global {
  interface Window {
    __house?: HouseState;
  }
}

const app = document.getElementById('app')!;
const start = document.getElementById('start')!;
const dot = document.getElementById('dot')!;
const glyph = document.getElementById('glyph')!;
const haze = document.getElementById('haze')!;

/** 128 bits from the browser's secure random source, as hex. */
function randomSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Message shown in diagnostics when the House server was configured but not reachable. */
let journeyFallbackReason: string | null = null;

/**
 * The House server is used only when VITE_API_URL is set at build time. If it cannot be reached,
 * the House still opens, with the journey kept in this browser.
 */
async function openJourney(): Promise<JourneyService> {
  const api = import.meta.env.VITE_API_URL as string | undefined;
  if (api) {
    try {
      return await RemoteJourneyService.connect(api);
    } catch (err) {
      journeyFallbackReason = err instanceof Error ? err.message : String(err);
      console.warn(`House server unreachable (${journeyFallbackReason}); journey kept locally.`);
    }
  }
  const engine = new JourneyEngine({
    journeyId: crypto.randomUUID(),
    visitorId: 'local-visitor',
    houseId: HOUSE_ID,
    houseSeed: HOUSE_SEED,
    journeySeed: randomSeed(),
    roomId: 'start-room',
  });
  return new LocalJourneyService(engine, planWorld);
}

async function boot(): Promise<void> {
  const rapier = await loadPhysics();
  const input = new Input(app);
  const engine = new Engine(app, input);
  await engine.init();

  const setFocus = (on: boolean) => {
    dot.classList.toggle('focus', on);
    glyph.classList.toggle('focus', on);
  };

  // Developer reproduction route (spec §53): `?world=<seed>` opens that forest directly.
  const worldSeed = new URLSearchParams(location.search).get('world');
  let experience: Experience | null = null;
  let devForest: ForestStage | null = null;
  if (worldSeed) {
    const d = buildDestination(
      seedsFromWorldSeed(worldSeed),
      { worldId: 'dev-world', journeyId: 'dev-journey' },
      DEFAULT_HOUSE_DNA,
    );
    // `&visual=<STYLE>` overrides the planned visual profile, to inspect each style.
    const visual = VisualProfileId.safeParse(new URLSearchParams(location.search).get('visual'));
    const reality = visual.success
      ? { ...d.reality, visualProfile: { id: visual.data } }
      : d.reality;
    devForest = new ForestStage(rapier, reality, d.forest, DEFAULT_HOUSE_DNA);
    engine.setStage(devForest);
  } else {
    const journey = await openJourney();
    experience = await Experience.create(
      rapier,
      engine,
      DEFAULT_HOUSE_DNA,
      HOUSE_SEED,
      journey,
      { haze, setFocus },
      planWorld,
    );
  }
  engine.start();

  // The start screen forwards clicks to the canvas, which requests pointer lock.
  start.addEventListener('click', () => app.click());
  input.onLockChanged((locked) => start.classList.toggle('hidden', locked));

  const current = () => experience?.stage ?? devForest!;

  const collectDiagnostics = (): DiagnosticsSnapshot => {
    const s = current();
    const j = experience ? experience.journey.journey : null;
    const forest = s instanceof ForestStage ? s : null;
    const info = engine.renderer.info;
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      renderer: engine.backend,
      journeyId: j?.journeyId ?? null,
      location: experience ? experience.phase : 'dev-world',
      roomId: s instanceof HouseStage ? s.room : null,
      worldId: forest ? (j?.worldId ?? 'dev-world') : null,
      seed: forest?.reality.seed ?? null,
      generatorVersion: forest?.reality.generatorVersion ?? null,
      visualProfile: forest?.reality.visualProfile.id ?? null,
      physicsProfile: s.player.physics.id,
      movementProfile: s.player.movement.id,
      gravity: s.player.physics.gravity.y,
      loadedAssets: {
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        drawCalls: info.render.drawCalls,
        triangles: info.render.triangles,
      },
      fps: engine.stats.fps,
      frameMs: engine.stats.frameMs,
      frameP95Ms: engine.stats.frameP95Ms,
      cpuMs: engine.stats.cpuMs,
      jsHeapMb: heap ? heap.usedJSHeapSize / 1048576 : null,
      online: navigator.onLine,
      journeyMode: experience
        ? experience.journey.mode === 'remote'
          ? 'server'
          : journeyFallbackReason
            ? `local (server unreachable: ${journeyFallbackReason})`
            : 'local'
        : 'dev-world',
      lastFailure: experience?.lastFailure ?? null,
      transitionGraph: transitionGraph(j),
    };
  };
  // Development builds always; production only with ?debug. Toggle with the backtick key.
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
    new DiagnosticsOverlay(document.getElementById('diagnostics')!, collectDiagnostics);
  }
  window.__house = {
    status: 'ready',
    renderer: engine.backend,
    physics: `rapier ${rapier.version()}`,
    frames: () => engine.frames,
    feet: () => current().player.feet,
    locked: () => input.isLocked,
    inReach: () => {
      const s = current();
      return s instanceof HouseStage ? s.inReach : false;
    },
    doorState: () => {
      const s = current();
      return s instanceof HouseStage ? s.doorState : null;
    },
    phase: () => experience?.phase ?? 'dev-world',
    journey: () => (experience ? experience.journey.journey : null),
    gpuMemory: () => ({ ...engine.renderer.info.memory }),
    diagnostics: collectDiagnostics,
    diagnosticsVisible: () => !document.getElementById('diagnostics')!.hidden,
    world: () => {
      const s = current();
      return s instanceof ForestStage
        ? {
            seed: s.reality.seed,
            generatorVersion: s.reality.generatorVersion,
            physicsProfile: s.reality.physicsProfile.id,
            lighting: s.reality.lightingProfile.id,
            trees: s.forest.stats.treeCount,
            clearings: s.forest.stats.clearingCount,
          }
        : null;
    },
  };
}

window.__house = {
  status: 'starting',
  frames: () => 0,
  feet: () => null,
  locked: () => false,
  inReach: () => false,
  doorState: () => null,
  phase: () => 'starting',
  journey: () => null,
  gpuMemory: () => null,
  diagnostics: () => null,
  diagnosticsVisible: () => false,
  world: () => null,
};
boot().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  window.__house = { ...window.__house!, status: 'error', error: message };
  console.error(err);
});
