import { DEFAULT_HOUSE_DNA, type Journey } from './domain';
import { buildDestination } from './journey/destination';
import { JourneyEngine } from './journey/engine';
import { Experience } from './journey/experience';
import { seedsFromWorldSeed } from './gen/seeds';
import { loadPhysics } from './platform/physics';
import { Engine } from './runtime/engine';
import { Input } from './runtime/input';
import { ForestStage } from './stages/forest-stage';
import { HouseStage } from './stages/house-stage';

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
  journey: () => Journey | null;
  gpuMemory: () => { geometries: number; textures: number } | null;
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
    devForest = new ForestStage(rapier, d.reality, d.forest, DEFAULT_HOUSE_DNA);
    engine.setStage(devForest);
  } else {
    const journey = new JourneyEngine({
      journeyId: crypto.randomUUID(),
      visitorId: 'local-visitor',
      houseId: HOUSE_ID,
      houseSeed: HOUSE_SEED,
      journeySeed: randomSeed(),
      roomId: 'start-room',
    });
    experience = new Experience(rapier, engine, DEFAULT_HOUSE_DNA, HOUSE_SEED, journey, {
      haze,
      setFocus,
    });
  }
  engine.start();

  // The start screen forwards clicks to the canvas, which requests pointer lock.
  start.addEventListener('click', () => app.click());
  input.onLockChanged((locked) => start.classList.toggle('hidden', locked));

  const current = () => experience?.stage ?? devForest!;
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
  world: () => null,
};
boot().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  window.__house = { ...window.__house!, status: 'error', error: message };
  console.error(err);
});
